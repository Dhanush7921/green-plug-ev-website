#!/usr/bin/env python3
"""
Prepare the CC-BY 4.0 "Car Concept" glTF sample asset for the GREEN PLUG EV website.

Source: KhronosGroup/glTF-Sample-Assets, Models/CarConcept/glTF-Binary/CarConcept.glb
        (itself derived from "Free Concept Car 004" by Unity Fan, public domain / CC0).
Licence of the source files: CC-BY-4.0, which EXCLUDES Khronos logos and trademarks.

What this script changes (documented in ASSETS.md):
  * removes every Khronos / 3DCommerce logo: emissive logo atlas, licence plate, steering emblem,
    tyre-sidewall base colour and embossed sidewall normal map (replaced by a clean procedural one)
  * removes hidden or heavy parts: wipers, engine, pedals, floor, floormats
  * drops the material-variants extension and the variant-only materials
  * recompresses textures (JPEG for occlusion / roughness, optimised PNG for normal maps)
  * quantises normals (int8) and in-range UVs (uint16) via KHR_mesh_quantization

Usage: python3 scripts/assets/prepare_car.py <CarConcept.glb> public/models/ev-concept.glb
Requires Pillow.
"""
import io
import json
import math
import struct
import sys

from PIL import Image

SRC, DST = sys.argv[1], sys.argv[2]

REMOVE_NODES = {
    'License Plate', 'InteriorSteeringEmblem', 'BodyWindshieldWipers', 'BodyWindshieldWipersBase', 'Engine',
    'InteriorPedalAccel', 'InteriorPedalAccelArm', 'InteriorPedalBrake', 'InteriorPedalBrakeArm',
    'InteriorFloor', 'InteriorFloormats',
}

raw = open(SRC, 'rb').read()
jlen, = struct.unpack('<I', raw[12:16])
gltf = json.loads(raw[20:20 + jlen])
boff = 20 + jlen
blen, = struct.unpack('<I', raw[boff:boff + 4])
BIN = raw[boff + 8: boff + 8 + blen]


def view_bytes(bv_index):
    bv = gltf['bufferViews'][bv_index]
    o = bv.get('byteOffset', 0)
    return BIN[o:o + bv['byteLength']]


# ---------------------------------------------------------------- nodes
for n in gltf['nodes']:
    if n.get('name') in REMOVE_NODES:
        n.pop('mesh', None)
        n['children'] = []
        n['name'] = (n.get('name') or '') + ' (removed)'

# ---------------------------------------------------------------- materials
LOGO_IMAGE = 3  # Khronos logo atlas (emissive on several parts, licence plate base colour)
for m in gltf['materials']:
    em = m.get('emissiveTexture')
    if em is not None and gltf['textures'][em['index']]['source'] == LOGO_IMAGE:
        m.pop('emissiveTexture')
        m['emissiveFactor'] = [0, 0, 0]
    if m.get('name') == 'Tireside':
        m['pbrMetallicRoughness'].pop('baseColorTexture', None)
        m['pbrMetallicRoughness']['baseColorFactor'] = [0.035, 0.038, 0.037, 1]
    exts = m.get('extensions', {})
    exts.pop('KHR_materials_variants', None)

# three.js derives tangent space in the shader when tangents are absent
for mesh in gltf['meshes']:
    for p in mesh['primitives']:
        p['attributes'].pop('TANGENT', None)

# drop variants: keep each primitive's default material only
gltf.get('extensions', {}).pop('KHR_materials_variants', None)
for mesh in gltf['meshes']:
    for p in mesh['primitives']:
        if 'extensions' in p:
            p['extensions'].pop('KHR_materials_variants', None)
            if not p['extensions']:
                p.pop('extensions')

# ---------------------------------------------------------------- reachability
used_meshes = set()


def walk(i):
    n = gltf['nodes'][i]
    if 'mesh' in n:
        used_meshes.add(n['mesh'])
    for c in n.get('children', []):
        walk(c)


for s in gltf['scenes']:
    for r in s['nodes']:
        walk(r)

used_materials = set()
used_accessors = set()
for mi in used_meshes:
    for p in gltf['meshes'][mi]['primitives']:
        if 'material' in p:
            used_materials.add(p['material'])
        used_accessors.update(p['attributes'].values())
        if 'indices' in p:
            used_accessors.add(p['indices'])

used_textures = set()


def collect_tex(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, dict) and k.endswith('Texture') and isinstance(v.get('index'), int):
                used_textures.add(v['index'])
            collect_tex(v)
    elif isinstance(obj, list):
        for v in obj:
            collect_tex(v)


for mi in used_materials:
    collect_tex(gltf['materials'][mi])
used_images = {gltf['textures'][t]['source'] for t in used_textures}

# ---------------------------------------------------------------- textures
TIRESIDE_NORMAL = None
for m in gltf['materials']:
    if m.get('name') == 'Tireside':
        TIRESIDE_NORMAL = gltf['textures'][m['normalTexture']['index']]['source']


def clean_sidewall_normal(size=512):
    """Neutral normal map with a few concentric grooves (no lettering or logos)."""
    img = Image.new('RGB', (size, size))
    px = img.load()
    c = size / 2
    rings = [0.62, 0.70, 0.84, 0.93]
    for y in range(size):
        for x in range(size):
            dx, dy = (x - c) / c, (y - c) / c
            r = math.hypot(dx, dy) + 1e-6
            g = 0.0
            for rr in rings:
                d = r - rr
                g += -d * math.exp(-(d * d) / 0.00018) * 60
            nx, ny = g * dx / r, g * dy / r
            nz = 1.0
            L = math.sqrt(nx * nx + ny * ny + nz * nz)
            px[x, y] = (int((nx / L * 0.5 + 0.5) * 255), int((ny / L * 0.5 + 0.5) * 255), int((nz / L * 0.5 + 0.5) * 255))
    return img


new_images = {}
for ii in sorted(used_images):
    im = gltf['images'][ii]
    src = Image.open(io.BytesIO(view_bytes(im['bufferView'])))
    usage = set()
    for t, tex in enumerate(gltf['textures']):
        if tex['source'] != ii or t not in used_textures:
            continue
        for mi in used_materials:
            m = gltf['materials'][mi]
            if m.get('normalTexture', {}).get('index') == t:
                usage.add('normal')
            if m.get('occlusionTexture', {}).get('index') == t:
                usage.add('occlusion')
    out = io.BytesIO()
    if ii == TIRESIDE_NORMAL:
        clean_sidewall_normal().save(out, 'PNG', optimize=True)
        mime = 'image/png'
    elif 'normal' in usage:
        img = src.convert('RGB')
        if img.width > 512:
            img = img.resize((512, 512 * img.height // img.width), Image.LANCZOS)
        img.save(out, 'PNG', optimize=True)
        mime = 'image/png'
    else:
        img = src.convert('RGB')
        if img.width > 1024:
            img = img.resize((1024, 1024 * img.height // img.width), Image.LANCZOS)
        img.save(out, 'JPEG', quality=84, optimize=True)
        mime = 'image/jpeg'
    new_images[ii] = (out.getvalue(), mime)

# ---------------------------------------------------------------- quantisation helpers
F32 = 5126


def acc_floats(a):
    acc = gltf['accessors'][a]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    bv = gltf['bufferViews'][acc['bufferView']]
    data = view_bytes(acc['bufferView'])
    stride = bv.get('byteStride', 4 * n)
    off = acc.get('byteOffset', 0)
    out = []
    for i in range(acc['count']):
        out.append(struct.unpack_from('<' + 'f' * n, data, off + i * stride))
    return out


# ---------------------------------------------------------------- rebuild buffer
chunks = []
new_views = []


def add_view(data, target=None, stride=None):
    pad = (-sum(len(c) for c in chunks)) % 4
    if pad:
        chunks.append(b'\x00' * pad)
    off = sum(len(c) for c in chunks)
    chunks.append(data)
    v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
    if target:
        v['target'] = target
    if stride:
        v['byteStride'] = stride
    new_views.append(v)
    return len(new_views) - 1


attr_kind = {}
for mi in used_meshes:
    for p in gltf['meshes'][mi]['primitives']:
        for name, a in p['attributes'].items():
            attr_kind[a] = name
        if 'indices' in p:
            attr_kind[p['indices']] = 'INDICES'

# per-mesh bounds: positions become normalised int16 in a cube, de-quantised by a child node's matrix
mesh_quant = {}
pos_owner = {}
for mi in used_meshes:
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for p in gltf['meshes'][mi]['primitives']:
        a = p['attributes']['POSITION']
        pos_owner[a] = mi
        acc = gltf['accessors'][a]
        for k in range(3):
            lo[k] = min(lo[k], acc['min'][k])
            hi[k] = max(hi[k], acc['max'][k])
    center = [(lo[k] + hi[k]) / 2 for k in range(3)]
    half = max((hi[k] - lo[k]) / 2 for k in range(3)) or 1.0
    mesh_quant[mi] = (center, half)

new_accessors = []
acc_map = {}
quantised = False
for a in sorted(used_accessors):
    acc = dict(gltf['accessors'][a])
    kind = attr_kind.get(a)
    if kind == 'POSITION' and acc['componentType'] == F32 and a in pos_owner:
        center, half = mesh_quant[pos_owner[a]]
        vals = acc_floats(a)
        buf = bytearray()
        qmin = [32767] * 3
        qmax = [-32767] * 3
        for v in vals:
            q = [max(-32767, min(32767, round((v[k] - center[k]) / half * 32767))) for k in range(3)]
            for k in range(3):
                qmin[k] = min(qmin[k], q[k])
                qmax[k] = max(qmax[k], q[k])
            buf += struct.pack('<hhhh', q[0], q[1], q[2], 0)
        acc.update(componentType=5122, normalized=True, byteOffset=0, min=qmin, max=qmax)
        acc['bufferView'] = add_view(bytes(buf), 34962, 8)
        quantised = True
    elif kind == 'NORMAL' and acc['componentType'] == F32:
        vals = acc_floats(a)
        buf = bytearray()
        for (x, y, z) in vals:
            L = math.sqrt(x * x + y * y + z * z) or 1.0
            buf += struct.pack('<bbbb', *(max(-127, min(127, round(v / L * 127))) for v in (x, y, z)), 0)
        acc.update(componentType=5120, normalized=True, byteOffset=0)
        acc.pop('min', None)
        acc.pop('max', None)
        acc['bufferView'] = add_view(bytes(buf), 34962, 4)
        quantised = True
    elif kind and kind.startswith('TEXCOORD') and acc['componentType'] == F32:
        vals = acc_floats(a)
        if all(0.0 <= u <= 1.0 and 0.0 <= v <= 1.0 for (u, v) in vals):
            buf = bytearray()
            for (u, v) in vals:
                buf += struct.pack('<HH', round(u * 65535), round(v * 65535))
            acc.update(componentType=5123, normalized=True, byteOffset=0)
            acc.pop('min', None)
            acc.pop('max', None)
            acc['bufferView'] = add_view(bytes(buf), 34962, 4)
            quantised = True
        else:
            n = 2
            acc['bufferView'] = add_view(b''.join(struct.pack('<ff', *uv) for uv in vals), 34962, 8)
            acc['byteOffset'] = 0
    else:
        bv = gltf['bufferViews'][acc['bufferView']]
        data = view_bytes(acc['bufferView'])
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
        comp = {5126: 4, 5125: 4, 5123: 2, 5121: 1, 5122: 2, 5120: 1}[acc['componentType']]
        elem = n * comp
        stride = bv.get('byteStride', elem)
        off = acc.get('byteOffset', 0)
        packed = b''.join(data[off + i * stride: off + i * stride + elem] for i in range(acc['count']))
        target = 34963 if kind == 'INDICES' else 34962
        acc['bufferView'] = add_view(packed, target, elem if target == 34962 and elem % 4 == 0 else None)
        acc['byteOffset'] = 0
    acc_map[a] = len(new_accessors)
    new_accessors.append(acc)

img_map = {}
new_images_json = []
for ii in sorted(used_images):
    data, mime = new_images[ii]
    img_map[ii] = len(new_images_json)
    new_images_json.append({'bufferView': add_view(data), 'mimeType': mime})

tex_map = {}
new_textures = []
for t in sorted(used_textures):
    tex = dict(gltf['textures'][t])
    tex['source'] = img_map[tex['source']]
    tex_map[t] = len(new_textures)
    new_textures.append(tex)


def remap_tex(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, dict) and 'index' in v and isinstance(v['index'], int) and k.endswith('Texture'):
                v['index'] = tex_map[v['index']]
            remap_tex(v)
    elif isinstance(obj, list):
        for v in obj:
            remap_tex(v)


mat_map = {}
new_materials = []
for mi in sorted(used_materials):
    m = json.loads(json.dumps(gltf['materials'][mi]))
    remap_tex(m)
    mat_map[mi] = len(new_materials)
    new_materials.append(m)

mesh_map = {}
new_meshes = []
for mi in sorted(used_meshes):
    mesh = json.loads(json.dumps(gltf['meshes'][mi]))
    for p in mesh['primitives']:
        p['attributes'] = {k: acc_map[v] for k, v in p['attributes'].items()}
        if 'indices' in p:
            p['indices'] = acc_map[p['indices']]
        if 'material' in p:
            p['material'] = mat_map[p['material']]
    mesh_map[mi] = len(new_meshes)
    new_meshes.append(mesh)

for ni in range(len(gltf['nodes'])):
    n = gltf['nodes'][ni]
    if 'mesh' not in n:
        continue
    old = n.pop('mesh')
    center, half = mesh_quant[old]
    child = {'name': (n.get('name') or 'mesh') + '_geo', 'mesh': mesh_map[old],
             'matrix': [half, 0, 0, 0, 0, half, 0, 0, 0, 0, half, 0, center[0], center[1], center[2], 1]}
    gltf['nodes'].append(child)
    n.setdefault('children', []).append(len(gltf['nodes']) - 1)

blob = b''.join(chunks)
blob += b'\x00' * ((-len(blob)) % 4)
gltf.update(accessors=new_accessors, bufferViews=new_views, images=new_images_json, textures=new_textures, materials=new_materials, meshes=new_meshes)
gltf['buffers'] = [{'byteLength': len(blob)}]
used_ext = set()
for m in new_materials:
    used_ext.update(m.get('extensions', {}).keys())
for e in ('KHR_texture_transform',):
    if 'KHR_texture_transform' in json.dumps(new_materials):
        used_ext.add(e)
if quantised:
    used_ext.add('KHR_mesh_quantization')
gltf['extensionsUsed'] = sorted(used_ext)
gltf['extensionsRequired'] = ['KHR_mesh_quantization'] if quantised else []
if not gltf['extensionsRequired']:
    gltf.pop('extensionsRequired')
gltf['asset']['generator'] = 'GREEN PLUG EV prepare_car.py (from glTF Sample Assets: Car Concept, CC-BY-4.0)'
gltf['asset']['copyright'] = 'Car Concept (c) 2024 Darmstadt Graphics Group GmbH, artist Eric Chadwick, CC-BY-4.0; based on a CC0 model by Unity Fan; logos removed and materials modified for GREEN PLUG EV'

js = json.dumps(gltf, separators=(',', ':')).encode()
js += b' ' * ((-len(js)) % 4)
out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + blob
open(DST, 'wb').write(out)
print(f'wrote {DST}: {len(out) / 1e6:.2f} MB (source {len(raw) / 1e6:.2f} MB); meshes {len(new_meshes)}, materials {len(new_materials)}, images {len(new_images_json)}')
