import { createRoot } from 'react-dom/client';
import '../../../src/styles/tokens.css';
import '../../../src/styles/base.css';
import '../../../src/styles/components.css';
import './styles/app.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
