import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './ui/styles.css';

class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  override state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  override render() {
    if (this.state.err) {
      return (
        <div className="fatal">
          <h1>Something broke</h1>
          <p>{this.state.err.message}</p>
          <button className="btn primary" onClick={() => location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
);
