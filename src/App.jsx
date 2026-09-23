import { useEffect } from 'react';
import { markup } from './markup/index.js';
import { initApp } from './app/platewatch.js';

let started = false;

export default function App() {
  useEffect(() => {
    // The app logic mutates this DOM directly, so it must run exactly once.
    if (started) return;
    started = true;
    initApp();
  }, []);

  return <div id="platewatch" dangerouslySetInnerHTML={{ __html: markup }} />;
}
