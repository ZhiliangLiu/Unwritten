import { createRoot } from 'react-dom/client';
import { App, bootstrap } from './app/App.tsx';
import './theme/global.css';

const container = document.getElementById('root');
if (container) {
  void bootstrap().then(() => {
    createRoot(container).render(<App />);
  });
}
