import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/index.css';

// No <StrictMode>: its dev-only double mount would initialise the app twice.
createRoot(document.getElementById('root')).render(<App />);
