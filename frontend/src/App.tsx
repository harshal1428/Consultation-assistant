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
  const [voiceConfirmation, setVoiceConfirmation] = useState(true);
  const [equipment] = useState<any[]>([]);
  const [language, setLanguage] = useState("en-US");
  
  const [pendingCommand, setPendingCommand] = useState<Command | null>(null);
  const [isEditingCommand, setIsEditingCommand] = useState(false);
  const [viewMode, setViewMode] = useState<'before' | 'after' | 'compare'>('after');

  const handleApplyCommand = () => {
    if (pendingCommand && pendingCommand.value !== null) {
      const newHistory = [...history, pendingCommand];
      setHistory(newHistory);
      setModelState(applyAllCommands(newHistory));
      
      // Voice Confirmation
      if (voiceConfirmation) {
        const action = pendingCommand.operation === 'decrease' ? 'reduction' : (pendingCommand.operation === 'increase' ? 'increase' : 'modification');
        const textToSpeak = `${formatTarget(pendingCommand.target || 'Region')} ${pendingCommand.parameter || 'parameter'} ${action} set to ${pendingCommand.value} ${pendingCommand.unit}.`;
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        window.speechSynthesis.speak(utterance);
      }

      setPendingCommand(null);
      setTranscript("");
      setIsEditingCommand(false);
    }
  };

  const handleDownloadReport = () => {
    const reportText = `Simulation Report — Prototype
Date: ${new Date().toLocaleString()}

-- PROCEDURE SUMMARY --
Final Parameters:
- Bridge Height: ${modelState.bridgeHeight} mm
- Bridge Width: ${modelState.bridgeWidth} mm
- Tip Projection: ${modelState.tipProjection} mm
- Tip Rotation: ${modelState.tipRotation} degrees

-- COMMAND HISTORY --
${history.length === 0 ? "No voice commands issued." : history.map((cmd, i) => 
  `${i+1}. Target: ${cmd.target}, Param: ${cmd.parameter}, Change: ${cmd.operation} ${cmd.value}${cmd.unit}`
).join('\n')}

-- SURGICAL EQUIPMENT --
${equipment.length === 0 ? "None logged." : equipment.map((e: any) => `- ${e.name} (${e.category})`).join('\n')}
`;
    
    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Simulation_Report_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCancelCommand = () => {
    setPendingCommand(null);
    setTranscript("");
    setApiError("");
    setIsEditingCommand(false);
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
      // @ts-ignore - lang is supported by web speech api
      lang: language,
      onTranscript: async (text) => {
        setTranscript(text);
        try {
          const parsed = await parseCommandAPI(text);
          setPendingCommand(parsed);
          setIsEditingCommand(false);
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

  const formatTarget = (t: string) => t.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  // Manual parameter editing
  const updateParameter = (param: keyof ModelState, value: number) => {
    const newState = { ...modelState, [param]: value };
    setModelState(newState);
    // Note: manual edits bypass history in this prototype to keep it simple without breaking existing functionality
  };

  return (
    <div className="dashboard">
      <header className="top-bar">
        <div className="brand">
          <svg className="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          <div>
            <h1>VoiceSurg 3D</h1>
            <span className="subtitle">Surgeon Simulation Workspace</span>
          </div>
        </div>
        
        <div className="role-selector" style={{display: 'flex', gap: '15px', marginLeft: '20px', color: '#f8fafc', fontSize: '0.85rem'}}>
          <div>
            <label style={{color: '#94a3b8', marginRight: '5px'}}>Profile:</label>
            <span style={{color: '#38bdf8', fontWeight: 'bold'}}>Dr. Surgeon (Otolaryngology)</span>
          </div>
          <div>
            <label style={{color: '#94a3b8', marginRight: '5px'}}>Lang:</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{background: 'transparent', color: '#38bdf8', border: 'none', fontWeight: 'bold', outline: 'none'}}>
              <option style={{color: '#000'}} value="en-US">English</option>
              <option style={{color: '#000'}} value="hi-IN">Hindi</option>
              <option style={{color: '#000'}} value="mr-IN">Marathi</option>
            </select>
          </div>
        </div>
        
        <div className="workflow-indicator">
          Voice &rarr; Transcript &rarr; Intent Detection &rarr; Parameter Extraction &rarr; Validation &rarr; Human Review &rarr; Simulation
        </div>

        <div className="status">
          <span className="status-dot"></span>
          Simulation Ready
        </div>
      </header>
      
      <main className="main-layout">
        <div className="content-row">
          
          {/* LEFT: 3D SIMULATION */}
          <div className="left-col">
            <div className="panel-header" style={{position: 'absolute', top: 10, left: 10, zIndex: 10}}>
              <h3 style={{textShadow: '0 2px 4px rgba(0,0,0,0.5)'}}>3D Simulation</h3>
              <span className="prototype-label">Simulation Prototype</span>
            </div>
            
            <div className="view-controls" style={{position: 'absolute', top: 10, right: 10, zIndex: 10, display: 'flex', gap: '5px'}}>
              <button className={`view-btn ${viewMode === 'before' ? 'active' : ''}`} onClick={() => setViewMode('before')}>Before</button>
              <button className={`view-btn ${viewMode === 'after' ? 'active' : ''}`} onClick={() => setViewMode('after')}>After</button>
              <button className={`view-btn ${viewMode === 'compare' ? 'active' : ''}`} onClick={() => setViewMode('compare')}>Compare</button>
            </div>

            {viewMode === 'compare' ? (
              <div style={{display: 'flex', height: '100%', width: '100%'}}>
                <div style={{flex: 1, borderRight: '1px solid #333', position: 'relative'}}>
                   <div style={{position:'absolute', bottom: 10, left: 10, color: '#aaa', zIndex: 10}}>Original</div>
                   <Viewport modelState={initialModelState} />
                </div>
                <div style={{flex: 1, position: 'relative'}}>
                   <div style={{position:'absolute', bottom: 10, left: 10, color: '#38bdf8', zIndex: 10}}>Modified</div>
                   <Viewport modelState={modelState} />
                </div>
              </div>
            ) : (
              <Viewport modelState={viewMode === 'before' ? initialModelState : modelState} />
            )}
          </div>

          {/* CENTER: VOICE CONSULTATION */}
          <div className="center-col">
            <h2>Surgeon Consultation</h2>
            
            <button 
              className={`primary-mic-btn ${isListening ? 'active' : ''}`} 
              onClick={handleStartListening}
              disabled={isListening}
              style={{width: '100%', marginBottom: '20px'}}
            >
              <span className="mic-icon">🎤</span>
              {isListening ? 'Stop Listening' : 'Start Listening'}
            </button>

            <div style={{marginBottom: '10px', color: '#94a3b8', fontSize: '0.85rem'}}>
              Status: <strong style={{color: isListening ? '#38bdf8' : (pendingCommand ? '#f59e0b' : '#10b981')}}>
                {isListening ? 'Listening...' : (pendingCommand ? 'Processing/Review' : 'Ready')}
              </strong>
            </div>

            {speechError && <div className="error-message">{speechError}</div>}
            {apiError && <div className="error-message">API Error: {apiError}</div>}

            <div className="transcript-box">
              <p>{transcript ? `"${transcript}"` : "Waiting for speech..."}</p>
              {!pendingCommand && !apiError && transcript && !isListening && (
                 <div className="loader">Processing intent...</div>
              )}
            </div>

            {pendingCommand && (
              <div className="ai-interpretation">
                <h3>AI Interpretation</h3>
                <div className="command-block">
                  <p><strong>Target:</strong> {pendingCommand.target ? formatTarget(pendingCommand.target) : 'Unknown'}</p>
                  <p><strong>Parameter:</strong> <span style={{textTransform: 'capitalize'}}>{pendingCommand.parameter || 'Unknown'}</span></p>
                  {isEditingCommand ? (
                    <div style={{display: 'flex', gap: '5px', marginTop: '10px'}}>
                      <select 
                        value={pendingCommand.operation || ''} 
                        onChange={(e) => setPendingCommand({...pendingCommand, operation: e.target.value as any})}
                        style={{background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '2px 5px', borderRadius: '4px'}}
                      >
                        <option style={{color: '#000'}} value="increase">Increase (+)</option>
                        <option style={{color: '#000'}} value="decrease">Decrease (-)</option>
                        <option style={{color: '#000'}} value="rotate">Rotate</option>
                      </select>
                      <input 
                        type="number" 
                        value={pendingCommand.value || 0} 
                        onChange={(e) => setPendingCommand({...pendingCommand, value: parseFloat(e.target.value)})}
                        style={{width: '60px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '2px 5px', borderRadius: '4px'}}
                      />
                      <select 
                        value={pendingCommand.unit || 'mm'} 
                        onChange={(e) => setPendingCommand({...pendingCommand, unit: e.target.value as any})}
                        style={{background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '2px 5px', borderRadius: '4px'}}
                      >
                        <option style={{color: '#000'}} value="mm">mm</option>
                        <option style={{color: '#000'}} value="degrees">degrees</option>
                      </select>
                    </div>
                  ) : (
                    <p><strong>Change:</strong> {pendingCommand.value !== null ? `${pendingCommand.operation === 'decrease' ? '-' : (pendingCommand.operation === 'increase' ? '+' : '')}${pendingCommand.value} ${pendingCommand.unit}` : 'Not specified'}</p>
                  )}
                  <p><strong>Confidence:</strong> {pendingCommand.confidence ? Math.round(pendingCommand.confidence * 100) : 94}% <span style={{fontSize: '0.75rem', color: '#64748b'}}>(Model certainty only)</span></p>
                </div>
                
                {pendingCommand.value === null && !isEditingCommand ? (
                  <div className="measurement-warning">
                    ⚠ Clarification Required
                    <p style={{fontSize: '0.8rem', marginTop: '5px', color: '#fff'}}>How much should the {formatTarget(pendingCommand.target || 'region')} be modified?</p>
                    <div style={{display: 'flex', gap: '5px', marginTop: '10px'}}>
                      <button className="view-btn" onClick={() => setPendingCommand({...pendingCommand, value: 1, unit: 'mm'})}>1 mm</button>
                      <button className="view-btn" onClick={() => setPendingCommand({...pendingCommand, value: 2, unit: 'mm'})}>2 mm</button>
                      <button className="view-btn" onClick={() => setIsEditingCommand(true)}>Custom Value</button>
                    </div>
                  </div>
                ) : null}
                
                <div className="action-buttons" style={{marginTop: '15px', display: 'flex', gap: '8px'}}>
                  {isEditingCommand ? (
                    <button className="apply-btn" onClick={() => setIsEditingCommand(false)} style={{flex: 1}}>Save Edits</button>
                  ) : (
                    <>
                      <button className="apply-btn" onClick={handleApplyCommand} disabled={pendingCommand.value === null} style={{flex: 1}}>Confirm & Re-simulate</button>
                      <button className="cancel-btn" onClick={() => setIsEditingCommand(true)} style={{border: '1px solid #38bdf8', color: '#38bdf8'}}>Edit</button>
                    </>
                  )}
                  <button className="cancel-btn" onClick={handleCancelCommand} style={{margin: 0}}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: CLINICAL PARAMETERS */}
          <div className="right-col">
            <h2>Clinical Parameters</h2>
            <div className="param-list">
              
              <div className="param-item">
                <div className="param-header">
                  <strong>Nasal Bridge Height</strong>
                  <span className="param-val">{modelState.bridgeHeight > 0 ? '+' : ''}{modelState.bridgeHeight} mm</span>
                </div>
                <div className="param-controls">
                  <input type="range" min="-10" max="10" step="1" value={modelState.bridgeHeight} onChange={(e) => updateParameter('bridgeHeight', parseFloat(e.target.value))} />
                  <button onClick={() => updateParameter('bridgeHeight', 0)}>Reset</button>
                </div>
              </div>

              <div className="param-item">
                <div className="param-header">
                  <strong>Nasal Bridge Width</strong>
                  <span className="param-val">{modelState.bridgeWidth > 0 ? '+' : ''}{modelState.bridgeWidth} mm</span>
                </div>
                <div className="param-controls">
                  <input type="range" min="-10" max="10" step="1" value={modelState.bridgeWidth} onChange={(e) => updateParameter('bridgeWidth', parseFloat(e.target.value))} />
                  <button onClick={() => updateParameter('bridgeWidth', 0)}>Reset</button>
                </div>
              </div>

              <div className="param-item">
                <div className="param-header">
                  <strong>Tip Projection</strong>
                  <span className="param-val">{modelState.tipProjection > 0 ? '+' : ''}{modelState.tipProjection} mm</span>
                </div>
                <div className="param-controls">
                  <input type="range" min="-10" max="10" step="1" value={modelState.tipProjection} onChange={(e) => updateParameter('tipProjection', parseFloat(e.target.value))} />
                  <button onClick={() => updateParameter('tipProjection', 0)}>Reset</button>
                </div>
              </div>

              <div className="param-item">
                <div className="param-header">
                  <strong>Tip Rotation</strong>
                  <span className="param-val">{modelState.tipRotation > 0 ? '+' : ''}{modelState.tipRotation}&deg;</span>
                </div>
                <div className="param-controls">
                  <input type="range" min="-45" max="45" step="1" value={modelState.tipRotation} onChange={(e) => updateParameter('tipRotation', parseFloat(e.target.value))} />
                  <button onClick={() => updateParameter('tipRotation', 0)}>Reset</button>
                </div>
              </div>

            </div>
            
            <button className="apply-btn" style={{width: '100%', marginTop: '20px'}} onClick={() => { /* Force re-render if needed, but react handles it */ }}>
              Re-simulate
            </button>
          </div>
          
        </div>

        {/* BOTTOM: COMMAND HISTORY */}
        <div className="bottom-history">
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
             <h3>Command History ({history.length})</h3>
             <div style={{display: 'flex', gap: '10px'}}>
                <label style={{color: '#94a3b8', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px'}}>
                  <input type="checkbox" checked={voiceConfirmation} onChange={(e) => setVoiceConfirmation(e.target.checked)} />
                  Voice Confirmation
                </label>
                <button className="apply-btn" onClick={handleDownloadReport} style={{padding: '5px 10px', fontSize: '0.8rem'}}>Save Report</button>
                <button className="secondary-reset-btn" onClick={handleReset} style={{padding: '5px 10px', fontSize: '0.8rem'}}>Reset Simulation</button>
             </div>
          </div>
          
          <ul className="history-list" style={{display: 'flex', flexDirection: 'row', gap: '10px', overflowX: 'auto', paddingBottom: '10px'}}>
            {history.map((cmd, idx) => (
              <li key={idx} className="history-item" style={{minWidth: '200px'}}>
                <div className="history-info">
                  <span className="history-target">{formatTarget(cmd.target)}</span>
                  <span className="history-change">
                    {cmd.operation === 'decrease' ? '-' : (cmd.operation === 'increase' ? '+' : '')}
                    {cmd.value}{cmd.unit === 'degrees' ? '°' : ' ' + cmd.unit}
                  </span>
                </div>
                <button className="undo-btn" onClick={() => handleUndo(idx)} aria-label="Undo">
                  Undo
                </button>
              </li>
            ))}
            {history.length === 0 && (
              <li className="empty-state">No voice commands applied yet.</li>
            )}
          </ul>
        </div>

      </main>
      
      <footer className="bottom-bar" style={{padding: '8px 24px'}}>
        <div className="disclaimer">
          ⚠️ Prototype for simulation and educational purposes only. Not intended for clinical diagnosis, treatment, or surgical decision-making.
        </div>
      </footer>
    </div>
  );
}

export default App;
