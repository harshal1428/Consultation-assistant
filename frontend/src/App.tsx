import { useState } from 'react';
import { Viewport } from './components/Viewport';
import type { ModelState, Command } from './scene/transformations/types';
import { initialModelState } from './scene/transformations/types';
import { applyAllCommands, resetModel } from './scene/transformations/logic';
import { speechService } from './services/speech';
import { parseCommandAPI } from './services/api';
import './App.css';

function App() {
  const [modelState, setModelState] = useState<ModelState>(initialModelState);
  const [history, setHistory] = useState<Command[]>([]);
  
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [speechError, setSpeechError] = useState("");
  const [apiError, setApiError] = useState("");
  
  const [pendingCommand, setPendingCommand] = useState<Command | null>(null);

  const handleApplyCommand = () => {
    if (pendingCommand && pendingCommand.value !== null) {
      const newHistory = [...history, pendingCommand];
      setHistory(newHistory);
      setModelState(applyAllCommands(newHistory));
      setPendingCommand(null);
      setTranscript("");
    }
  };

  const handleCancelCommand = () => {
    setPendingCommand(null);
    setTranscript("");
    setApiError("");
  };

  const handleUndo = (index: number) => {
    const newHistory = [...history];
    newHistory.splice(index, 1);
    setHistory(newHistory);
    setModelState(applyAllCommands(newHistory));
  };

  const handleReset = () => {
    setModelState(resetModel());
    setHistory([]);
    setPendingCommand(null);
    setTranscript("");
    setApiError("");
    setSpeechError("");
  };

  const handleStartListening = () => {
    setIsListening(true);
    setTranscript("");
    setSpeechError("");
    setApiError("");
    setPendingCommand(null);
    
    speechService.startListening({
      onTranscript: async (text) => {
        setTranscript(text);
        try {
          const parsed = await parseCommandAPI(text);
          setPendingCommand(parsed);
        } catch (err: any) {
          setApiError(err.message);
        }
      },
      onError: (error) => {
        setSpeechError(error);
      },
      onEnd: () => {
        setIsListening(false);
      }
    });
  };

  const handleExampleCommand = async (text: string) => {
    setIsListening(false);
    setTranscript(text);
    setSpeechError("");
    setApiError("");
    setPendingCommand(null);
    try {
      const parsed = await parseCommandAPI(text);
      setPendingCommand(parsed);
    } catch (err: any) {
      setApiError(err.message);
    }
  };

  const formatTarget = (t: string) => t.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  return (
    <div className="dashboard">
      <header className="top-bar">
        <div className="brand">
          <svg className="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          <div>
            <h1>VoiceSurg 3D</h1>
            <span className="subtitle">Voice-Controlled Surgical Simulation</span>
          </div>
        </div>
        
        <div className="workflow-indicator">
          VOICE &rarr; INTENT &rarr; PARAMETERS &rarr; CONFIRM &rarr; SIMULATE
        </div>

        <div className="system-status">
          <span className="status-item"><span className={`dot ${speechError ? 'red' : 'green'}`}></span> Speech: {speechError ? 'Error' : 'Ready'}</span>
          <span className="status-item"><span className={`dot ${apiError ? 'red' : 'green'}`}></span> Parser: {apiError ? 'Error' : 'Ready'}</span>
          <span className="status-item"><span className="dot green"></span> 3D Engine: Ready</span>
        </div>
        <div className="status">
          <span className="status-dot"></span>
          Simulation Active
        </div>
      </header>
      
      <main className="main-layout">
        <div className="viewport-section">
          <Viewport modelState={modelState} />
        </div>
        
        <aside className="sidebar">
          
          <div className="panel voice-panel">
            <div className="panel-header">
              <h3>Voice Input</h3>
              {isListening && <span className="listening-badge">Listening...</span>}
            </div>
            
            {speechError && <div className="error-message">{speechError}</div>}
            {apiError && <div className="error-message">API Error: {apiError}</div>}
            
            {transcript && (
              <div className="transcript-box">
                <p>"{transcript}"</p>
                {!pendingCommand && !apiError && !isListening && (
                   <div className="loader">Processing intent...</div>
                )}
              </div>
            )}
            
            {!transcript && !isListening && !speechError && (
              <div className="empty-state">
                Ready for voice command.
              </div>
            )}
          </div>
          
          <div className="panel demo-panel">
            <div className="panel-header">
              <h3>Demo Mode</h3>
            </div>
            <p className="demo-description">Try example commands if microphone is unavailable.</p>
            <div className="demo-buttons">
              <button className="demo-btn" onClick={() => handleExampleCommand("Reduce the bridge by 2 millimeters")}>Reduce bridge by 2 mm</button>
              <button className="demo-btn" onClick={() => handleExampleCommand("Increase tip projection by 1 millimeter")}>Increase tip projection by 1 mm</button>
              <button className="demo-btn" onClick={() => handleExampleCommand("Raise the tip by 2 millimeters")}>Raise tip by 2 mm</button>
              <button className="demo-btn" onClick={() => handleExampleCommand("Narrow the bridge by 1 millimeter")}>Narrow bridge by 1 mm</button>
              <button className="demo-btn" onClick={() => handleExampleCommand("Rotate the tip upward by 5 degrees")}>Rotate tip by 5 degrees</button>
            </div>
          </div>

          {pendingCommand && (
            <div className="panel clinical-panel">
              <div className="panel-header">
                <h3>AI Interpretation</h3>
              </div>
              
              <div className="interpretation-details">
                <div className="interp-row">
                  <span>Target</span>
                  <span>{pendingCommand.target ? formatTarget(pendingCommand.target) : 'Unknown'}</span>
                </div>
                <div className="interp-row">
                  <span>Parameter</span>
                  <span style={{textTransform: 'capitalize'}}>{pendingCommand.parameter || 'Unknown'}</span>
                </div>
                <div className="interp-row highlight">
                  <span>Change</span>
                  <span>
                    {pendingCommand.value !== null 
                      ? `${pendingCommand.operation === 'decrease' ? '-' : (pendingCommand.operation === 'increase' ? '+' : '')}${pendingCommand.value} ${pendingCommand.unit}` 
                      : 'N/A'}
                  </span>
                </div>
                <div className="interp-row">
                  <span>Confidence</span>
                  <span className={`confidence-score ${pendingCommand.confidence > 0.8 ? 'high' : 'low'}`}>
                    {Math.round(pendingCommand.confidence * 100)}%
                  </span>
                </div>
                
                {pendingCommand.value === null && (
                  <div className="measurement-warning">
                    ⚠️ Additional measurement required
                  </div>
                )}
                
                <div className="action-buttons">
                  <button 
                    className="apply-btn" 
                    onClick={handleApplyCommand}
                    disabled={pendingCommand.value === null}
                  >
                    Apply Change
                  </button>
                  <button className="cancel-btn" onClick={handleCancelCommand}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          <div className="panel history-panel">
            <div className="panel-header">
              <h3>Command History</h3>
              <span className="history-count">{history.length}</span>
            </div>
            <ul className="history-list">
              {history.map((cmd, idx) => (
                <li key={idx} className="history-item">
                  <div className="history-info">
                    <span className="history-target">{formatTarget(cmd.target)}</span>
                    <span className="history-change">
                      {cmd.operation === 'decrease' ? '-' : (cmd.operation === 'increase' ? '+' : '')}
                      {cmd.value}{cmd.unit === 'degrees' ? '°' : ' ' + cmd.unit}
                    </span>
                  </div>
                  <button className="undo-btn" onClick={() => handleUndo(idx)} aria-label="Undo">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10"></polyline>
                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                    </svg>
                  </button>
                </li>
              ))}
              {history.length === 0 && (
                <li className="empty-state">No commands applied yet.</li>
              )}
            </ul>
          </div>
        </aside>
      </main>

      <footer className="bottom-bar">
        <div className="footer-actions">
          <button 
            className={`primary-mic-btn ${isListening ? 'active' : ''}`} 
            onClick={handleStartListening}
            disabled={isListening}
          >
            <span className="mic-icon">🎤</span>
            {isListening ? 'Listening...' : 'Start Listening'}
          </button>
          
          <button className="secondary-reset-btn" onClick={handleReset}>
            Reset Simulation
          </button>
        </div>
        
        <div className="disclaimer">
          ⚠️ Prototype for simulation and educational purposes only. Not intended for clinical diagnosis, treatment, or surgical decision-making.
        </div>
      </footer>
    </div>
  );
}

export default App;
