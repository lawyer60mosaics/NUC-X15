import React from 'react';
import ReactDOM from 'react-dom/client';
import StudioApp from './StudioApp';
import './styles/studio-app.css';
import './styles/studio-ec.css';
import './styles/studio-ec-controls.css';
import './styles/studio-live-controls.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <StudioApp />
  </React.StrictMode>
);
