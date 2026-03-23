// App.tsx
import KVCacheSimulator from './Kvcachesimulator.tsx';
export default function App() {
  return <KVCacheSimulator />;
}

// main.tsx  (already in your Vite project — just make sure it imports App)
// import { StrictMode } from 'react'
// import { createRoot } from 'react-dom/client'
// import App from './App.tsx'
// createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)