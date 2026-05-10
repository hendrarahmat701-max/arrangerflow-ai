/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  Music, 
  Settings, 
  Layout, 
  Layers, 
  Activity, 
  Cpu, 
  Download, 
  Play, 
  Square,
  Plus,
  ChevronRight,
  Disc,
  Piano as PianoIcon,
  Mic2,
  Share2,
  Loader2,
  Trash2,
  Save,
  Volume2,
  Menu,
  X,
  Database,
  AlertTriangle,
  HardDrive,
  Terminal,
  MessageSquare
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Project, INITIAL_PROJECT, GENRES, SectionType, StyleSection, SF2Instrument, LogLevel, LogModule, LogEntry, StyleLane, SoundAsset } from './types';
import { analyzeTrackIdeas } from './services/geminiService';
import { MidiEngine } from './services/midiEngine';
import { SF2Engine } from './services/sf2Engine';
import { PlaybackEngine } from './services/playbackEngine';

export default function App() {
  const [project, setProject] = useState<Project>(INITIAL_PROJECT);
  const [activeTab, setActiveTab] = useState<'arranger' | 'piano-roll' | 'sf2' | 'ai' | 'inventory' | 'diagnostic' | 'library'>('arranger');
  const [selectedSectionId, setSelectedSectionId] = useState<string>(project.sections[0].id);
  const [aiInput, setAiInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [playbackEngineReady, setPlaybackEngineReady] = useState(false);
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const [agentStatus, setAgentStatus] = useState<'ONLINE' | 'OFFLINE'>('OFFLINE');
  const [agentMessages, setAgentMessages] = useState<any[]>([]);
  const [agentHeartbeat, setAgentHeartbeat] = useState<any>(null);
  const [agentInput, setAgentInput] = useState('');
  const agentWs = useRef<WebSocket | null>(null);

  useEffect(() => {
    const connectAgent = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}`);
      
      ws.onopen = () => {
        console.log('Connected to Agent IPC');
        setAgentStatus('ONLINE');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'agent_status') {
            setAgentStatus(msg.status);
          } else if (msg.type === 'agent_log') {
            try {
              const internal = JSON.parse(msg.data);
              if (internal.type === 'heartbeat') {
                setAgentHeartbeat(internal.data);
              } else if (internal.type === 'agent_response') {
                setAgentMessages(prev => [...prev.slice(-49), { type: 'agent', data: internal.data }]);
              } else {
                setAgentMessages(prev => [...prev.slice(-49), internal]);
              }
            } catch {
              setAgentMessages(prev => [...prev.slice(-49), { type: 'log', data: msg.data }]);
            }
          }
        } catch (err) {
          console.error('IPC Message Error:', err);
        }
      };

      ws.onclose = () => {
        setAgentStatus('OFFLINE');
        setTimeout(connectAgent, 5000);
      };

      agentWs.current = ws;
    };

    connectAgent();
    return () => agentWs.current?.close();
  }, []);

  const sendAgentCommand = () => {
    if (!agentInput.trim() || !agentWs.current) return;
    agentWs.current.send(JSON.stringify({ type: 'command', command: agentInput }));
    setAgentMessages(prev => [...prev.slice(-49), { type: 'user', data: agentInput }]);
    setAgentInput('');
  };

  const addLog = (module: LogModule, level: LogLevel, message: string, metadata?: any) => {
    const newLog: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      module,
      level,
      message,
      metadata
    };
    setProject(prev => ({
      ...prev,
      logs: [newLog, ...prev.logs].slice(0, 100)
    }));
  };

  const validateProject = () => {
    addLog('SYSTEM', 'INFO', 'Starting workstation validation sequence...');
    let warnings = 0;
    let errors = 0;

    if (project.bpm < 60 || project.bpm > 200) {
      addLog('STYLE', 'WARNING', `BPM (${project.bpm}) is outside standard arranger range (60-200).`);
      warnings++;
    }

    const bankMap = new Map<string, string>();
    project.inventory.forEach(asset => {
      const key = `${asset.bank}-${asset.msb}-${asset.lsb}`;
      if (bankMap.has(key)) {
        addLog('SF2', 'ERROR', `Conflict: Bank ${key} already assigned to ${bankMap.get(key)}.`);
        errors++;
      }
      bankMap.set(key, asset.name);
    });

    if (project.sections.length === 0) {
      addLog('STYLE', 'ERROR', 'No sections defined.');
      errors++;
    }

    const mappedTracks = Object.keys(project.sf2Mapping).length;
    if (mappedTracks === 0) {
      addLog('EXPANSION', 'ERROR', 'Export blocked: No tracks mapped.');
      errors++;
    }

    const summaryLevel: LogLevel = errors > 0 ? 'ERROR' : warnings > 0 ? 'WARNING' : 'INFO';
    addLog('VALIDATION', summaryLevel, `Validation complete. Errors: ${errors}, Warnings: ${warnings}.`);
    
    setActiveTab('diagnostic');
  };

  const bankConflicts = useMemo(() => {
    const conflicts: string[] = [];
    const usedBanks = new Map<string, string>();
    
    project.inventory.forEach(asset => {
      const key = `${asset.bank}-${asset.msb}-${asset.lsb}`;
      if (usedBanks.has(key)) {
        conflicts.push(`Bank ${key} is shared by ${asset.name} and ${usedBanks.get(key)}`);
      }
      usedBanks.set(key, asset.name);
    });
    
    return conflicts;
  }, [project.inventory]);

  const selectedSection = project.sections.find(s => s.id === selectedSectionId);

  const handleExportStyle = async () => {
    addLog('EXPORT', 'INFO', 'Starting export sequence...');
    setIsExporting(true);
    
    let errors = 0;
    bankConflicts.forEach(c => { addLog('SF2', 'ERROR', `Conflict: ${c}`); errors++; });
    if (project.inventory.length === 0) { addLog('EXPANSION', 'ERROR', 'Empty sound inventory.'); errors++; }
    
    if (errors > 0) {
      addLog('EXPORT', 'CRITICAL', 'Export aborted.');
      setIsExporting(false);
      return;
    }

    await new Promise(r => setTimeout(r, 1500));
    
    const projectData = JSON.stringify(project, null, 2);
    const blob = new Blob([projectData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.name.replace(/\s+/g, '_')}_v1_export.afx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setIsExporting(false);
    addLog('EXPORT', 'INFO', '.AFX Prototype exported successfully.');
  };

  const addSection = () => {
    const newSection: StyleSection = {
      id: `sec-${Date.now()}`,
      type: 'Main',
      variation: 'A',
      bars: 4,
      tempo: project.bpm,
      key: 'C',
      chordProgression: ['C', 'F', 'G', 'C'],
      lanes: [
        { id: `l-${Date.now()}-1`, role: 'Drum', midiChannel: 10, muted: false, notes: [] },
        { id: `l-${Date.now()}-2`, role: 'Bass', midiChannel: 2, muted: false, notes: [] }
      ]
    };
    setProject({ ...project, sections: [...project.sections, newSection] });
    setSelectedSectionId(newSection.id);
  };

  return (
    <div className="min-h-screen bg-hw-bg text-white font-sans selection:bg-hw-accent/30 overflow-hidden flex flex-col">
      <header className="h-14 border-b border-hw-border bg-hw-panel flex items-center justify-between px-4 lg:px-6 z-40">
        <div className="flex items-center gap-3 lg:gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] font-mono text-hw-muted tracking-widest uppercase">ArrangerFlow AI</span>
            <span className="text-sm font-bold tracking-tight text-white uppercase">v1.9.5</span>
          </div>
        </div>
        <div className="flex items-center gap-2 lg:gap-4">
          <button className="hidden sm:block bg-hw-data hover:brightness-110 text-black text-[10px] font-bold px-3 py-1.5 rounded uppercase tracking-wider transition-colors shadow-lg">
            {isExporting ? <Loader2 className="w-3 h-3 animate-spin inline mr-2" /> : <Download className="w-3 h-3 inline mr-1" />}
            Export
          </button>
        </div>
      </header>

      <main className="flex-1 bg-hw-workspace p-4 lg:p-6 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="bg-hw-panel rounded-lg border border-hw-border p-6 shadow-2xl">
            <h2 className="text-2xl font-bold text-white uppercase mb-4">ArrangerFlow AI</h2>
            <p className="text-hw-muted mb-4">Symbolic Arranger Workstation - Ready for Operations</p>
            <button 
              onClick={addSection}
              className="px-6 py-2 bg-hw-accent text-black rounded font-bold uppercase tracking-widest hover:brightness-110 transition-all"
            >
              + Add Section
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-hw-panel rounded-lg border border-hw-border p-6 shadow-xl">
              <h3 className="text-lg font-bold text-hw-accent uppercase mb-3">Sections</h3>
              <div className="space-y-2">
                {project.sections.map(s => (
                  <div key={s.id} className="p-3 bg-hw-card rounded border border-hw-border text-sm">
                    {s.type} {s.variation} - {s.bars} bars
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-hw-panel rounded-lg border border-hw-border p-6 shadow-xl">
              <h3 className="text-lg font-bold text-hw-data uppercase mb-3">Inventory</h3>
              <div className="space-y-2">
                {project.inventory.map(asset => (
                  <div key={asset.id} className="p-3 bg-hw-card rounded border border-hw-border text-sm">
                    {asset.name} - {asset.type}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-hw-panel rounded-lg border border-hw-border p-6 shadow-xl">
            <h3 className="text-lg font-bold text-hw-status uppercase mb-3">Recent Logs</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {project.logs.slice(0, 10).map(log => (
                <div key={log.id} className="p-2 bg-black/40 rounded text-xs font-mono">
                  <span className="text-hw-muted">[{log.level}]</span> {log.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}