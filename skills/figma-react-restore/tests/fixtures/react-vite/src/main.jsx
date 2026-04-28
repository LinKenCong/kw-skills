import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main data-figma-node="1:1" className="page">
      <section data-figma-node="1:2" className="hero">
        <div data-figma-node="1:3" className="panel" />
        <div className="copy">
          <h1 data-figma-node="1:4">Launch with precision</h1>
          <p data-figma-node="1:5">A compact fixture for layout, typography, color, image, and overflow verification.</p>
          <button data-figma-node="1:6">Start restore</button>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
