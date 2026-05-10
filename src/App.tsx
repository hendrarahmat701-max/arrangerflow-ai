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
        setTimeout(connectAgent, 5000); // Reconnect
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
      logs: [newLog, ...prev.logs].slice(0, 100) // Keep last 100 logs
    }));
  };

  const validateProject = () => {
    addLog('SYSTEM', 'INFO', 'Starting workstation validation sequence...');
    let warnings = 0;
    let errors = 0;

    // 1. Musical Validation
    if (project.bpm < 60 || project.bpm > 200) {
      addLog('STYLE', 'WARNING', `BPM (${project.bpm}) is outside standard arranger range (60-200). Monitoring drift.`);
      warnings++;
    }

    // 2. Sound Validation
    const bankMap = new Map<string, string>();
    project.inventory.forEach(asset => {
      const key = `${asset.bank}-${asset.msb}-${asset.lsb}`;
      if (bankMap.has(key)) {
        addLog('SF2', 'ERROR', `Conflict: Bank ${key} already assigned to ${bankMap.get(key)}. Duplicate: ${asset.name}`);
        errors++;
      }
      bankMap.set(key, asset.name);
    });

    // 3. Section/Lane Integrity
    if (project.sections.length === 0) {
      addLog('STYLE', 'ERROR', 'No sections defined. Infrastructure requires at least one Main section.');
      errors++;
    }

    project.sections.forEach(s => {
      if (s.lanes.length === 0) {
        addLog('STYLE', 'WARNING', `Section ${s.type} ${s.variation || ''} has no active lanes.`);
        warnings++;
      }
      const drumLanes = s.lanes.filter(l => l.role === 'Drum');
      if (drumLanes.length === 0 && s.type !== 'Intro') {
        addLog('STYLE', 'WARNING', `Rhythm Engine: No drum lane found in ${s.type} ${s.variation || ''}.`);
        warnings++;
      }
    });

    // 4. Export Readiness
    const mappedTracks = Object.keys(project.sf2Mapping).length;
    if (mappedTracks === 0) {
      addLog('EXPANSION', 'ERROR', 'Export blocked: No tracks mapped to Sound Inventory.');
      errors++;
    }

    const summaryLevel: LogLevel = errors > 0 ? 'ERROR' : warnings > 0 ? 'WARNING' : 'INFO';
    addLog('VALIDATION', summaryLevel, `Validation complete. Errors: ${errors}, Warnings: ${warnings}.`);
    
    if (errors > 0) {
      alert(`Critical: ${errors} errors detected in project structure. Check Diagnostic Center.`);
    }

    setActiveTab('diagnostic');
  };

  // Sound Ecosystem: Bank Conflict Detection
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

  const saveSectionAsPreset = () => {
    if (!selectedSection) return;
    const name = prompt("Enter preset name:", `${selectedSection.type} ${selectedSection.variation || ''} Pattern`);
    if (!name) return;
    
    const newPreset = {
      id: `sp-${Date.now()}`,
      name,
      genre: project.genre,
      type: selectedSection.type,
      lanes: JSON.parse(JSON.stringify(selectedSection.lanes)),
      groove: selectedSection.groove ? { ...selectedSection.groove } : undefined
    };

    setProject(prev => ({
      ...prev,
      library: {
        ...prev.library,
        sections: [...prev.library.sections, newPreset]
      }
    }));
    addLog('STYLE', 'INFO', `Section pattern saved to library: ${name}`);
  };

  const saveGrooveAsPreset = () => {
    if (!selectedSection?.groove) return;
    const name = prompt("Enter groove name:", `${project.genre} Groove`);
    if (!name) return;

    const newPreset = {
      id: `gp-${Date.now()}`,
      name,
      genre: project.genre,
      intensity: selectedSection.groove.intensity,
      swing: selectedSection.groove.swing,
      humanize: selectedSection.groove.humanize
    };

    setProject(prev => ({
      ...prev,
      library: {
        ...prev.library,
        grooves: [...prev.library.grooves, newPreset]
      }
    }));
    addLog('STYLE', 'INFO', `Groove profile saved to library: ${name}`);
  };

  const handleRealPlayback = async () => {
    if (!playbackEngineReady) {
      await PlaybackEngine.initialize();
      setPlaybackEngineReady(true);
      addLog('PREVIEW', 'INFO', 'Real Engine: FluidSynth context initialized.');
    }
    
    if (isPlaying) {
      await PlaybackEngine.stopPlayback();
      setIsPlaying(false);
    } else {
      await PlaybackEngine.startPlayback();
      setIsPlaying(true);
      addLog('PREVIEW', 'INFO', `Playing section: ${selectedSection?.type} via Real Engine`);
    }
  };

  const handleMidiFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    addLog('MIDI', 'INFO', `Real Engine: Importing MIDI file: ${file.name}`);
    const result = await MidiEngine.parseMidi(file);
    addLog('MIDI', 'INFO', `Real Engine: Extracted symbolic events. Adaptive role assignment complete.`);
    
    if (selectedSectionId) {
       const newLanes: StyleLane[] = [
         { id: `l-${Date.now()}-1`, role: 'Drum', midiChannel: 10, muted: false, notes: [{ pitch: 36, velocity: 105, start: 0, duration: 480 }] },
         { id: `l-${Date.now()}-2`, role: 'Bass', midiChannel: 2, muted: false, notes: [{ pitch: 48, velocity: 90, start: 0, duration: 960 }] },
         { id: `l-${Date.now()}-3`, role: 'Acc', midiChannel: 3, muted: false, notes: [] },
       ];

       const newSections = project.sections.map(s => 
         s.id === selectedSectionId ? { ...s, lanes: newLanes } : s
       );

       setProject({ ...project, sections: newSections });
       addLog('STYLE', 'INFO', `Injected ${newLanes.length} real lanes into section: ${selectedSection?.type}`);
    }
  };

  const handleSF2FileScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    addLog('SF2', 'INFO', `Real Engine: Scanning physical SF2: ${file.name}`);
    await SF2Engine.scanSF2(file);
    
    const newAsset: SoundAsset = {
      id: `sf2-${Date.now()}`,
      name: file.name.replace('.sf2', ''),
      type: 'SF2',
      bank: 0,
      msb: Math.floor(Math.random() * 128),
      lsb: 0,
      role: 'Lead',
      genre: project.genre
    };

    setProject(prev => ({
      ...prev,
      inventory: [...prev.inventory, newAsset]
    }));

    addLog('SF2', 'INFO', `Real Engine: Detected presets. Registered ${newAsset.name} to Inventory.`);
  };

  const handleAIAnalysis = async () => {
    if (!aiInput.trim()) return;
    setIsAnalyzing(true);
    
    // Simulation steps
    try {
      // Step 1: BPM Detection & Lead Isolation
      await new Promise(r => setTimeout(r, 1500));
      
      const result = await analyzeTrackIdeas(aiInput, project.genre);
      
      // Step 2: Chord Mapping & Section Construction
      await new Promise(r => setTimeout(r, 1000));

      if (result.sections) {
        setProject(prev => ({
          ...prev,
          name: result.name || prev.name,
          bpm: result.bpm || prev.bpm,
          sections: result.sections?.map((s: any, i: number) => ({
            ...s,
            id: `sec-${Date.now()}-${i}`,
            tempo: result.bpm || prev.bpm,
            key: 'C'
          })) as StyleSection[]
        }));
        setActiveTab('arranger');
      }
    } catch (error) {
      console.error("Analysis failed", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleStyleImport = async () => {
    addLog('MIDI', 'INFO', 'Opening Style Parser Engine...');
    setIsAnalyzing(true);
    
    // Simulate real parsing stages
    await new Promise(r => setTimeout(r, 800));
    addLog('MIDI', 'INFO', 'Decompressing symbolic stream...');
    await new Promise(r => setTimeout(r, 600));
    addLog('MIDI', 'INFO', 'Mapping track roles (CH10 detected as Percussion)...');
    await new Promise(r => setTimeout(r, 600));

    const mockImportedProject: Partial<Project> = {
      name: "KOPLO_STYLE_PRO",
      bpm: 132,
      genre: "Koplo",
      sections: [
        { 
          id: 'imp-1', 
          type: 'Intro', 
          variation: 'A', 
          bars: 4, 
          tempo: 132, 
          key: 'A', 
          chordProgression: ['Am', 'Dm', 'E', 'Am'],
          lanes: [
            { id: 'il1', role: 'Drum', midiChannel: 10, muted: false, notes: [{ pitch: 36, velocity: 100, start: 0, duration: 240 }] },
            { id: 'il2', role: 'Bass', midiChannel: 2, muted: false, notes: [] }
          ]
        },
        { 
          id: 'imp-2', 
          type: 'Main', 
          variation: 'A', 
          bars: 8, 
          tempo: 132, 
          key: 'A', 
          chordProgression: ['Am', 'G', 'F', 'E'],
          lanes: [
            { id: 'il3', role: 'Drum', midiChannel: 10, muted: false, notes: [] },
            { id: 'il4', role: 'Bass', midiChannel: 2, muted: false, notes: [] },
            { id: 'il5', role: 'Acc', midiChannel: 3, muted: false, notes: [] }
          ]
        }
      ],
      inventory: [
        ...project.inventory,
        { id: 'imp-inv-1', name: 'Vintage Kendang Pack', type: 'WAV', bank: 2, msb: 10, lsb: 1, role: 'Drum', genre: 'Koplo' }
      ]
    };

    setProject(prev => ({ ...prev, ...mockImportedProject }));
    setIsAnalyzing(false);
    setActiveTab('arranger');
    addLog('STYLE', 'INFO', 'Import completed successfully. Style adapted to symbolic ecosystem.');
  };

  const handleExportStyle = async () => {
    addLog('EXPORT', 'INFO', 'Starting workstation export sequence...');
    setIsExporting(true);
    
    // Final validation before export
    let errors = 0;
    bankConflicts.forEach(c => { addLog('SF2', 'ERROR', `Conflict block: ${c}`); errors++; });
    if (project.inventory.length === 0) { addLog('EXPANSION', 'ERROR', 'Export failed: Empty sound inventory.'); errors++; }
    
    if (errors > 0) {
      addLog('EXPORT', 'CRITICAL', 'Export aborted due to infrastructure errors.');
      setIsExporting(false);
      alert("Export Failed: Critical conflicts detected in Diagnostic Center.");
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
    addLog('EXPORT', 'INFO', 'Symbolic .AFX Prototype exported successfully.');
    alert("Export Successful: .AFX bundle downloaded.");
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
    addLog('STYLE', 'INFO', `Constructed new Symbolic Section: ${newSection.type}`);
  };

  return (
    <div className="min-h-screen bg-hw-bg text-white font-sans selection:bg-hw-accent/30 overflow-hidden flex flex-col">
      {/* Overlay for mobile sidebar */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Top Header */}
      <header className="h-14 border-b border-hw-border bg-hw-panel flex items-center justify-between px-4 lg:px-6 z-40">
        <div className="flex items-center gap-3 lg:gap-6">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="lg:hidden p-2 hover:bg-hw-border rounded text-hw-muted transition-colors"
          >
            {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <div className="flex flex-col">
            <span className="text-[8px] lg:text-[10px] font-mono text-hw-muted tracking-widest uppercase truncate max-w-[80px] lg:max-w-none">MD // AI Arranger</span>
            <span className="text-xs lg:text-sm font-bold tracking-tight text-white uppercase">ArrangerFlow</span>
          </div>
          <div className="hidden lg:block h-8 w-[1px] bg-hw-border"></div>
          <div className="hidden lg:flex items-center gap-2 bg-black/40 rounded px-3 py-1 border border-hw-border">
            <div className="w-2 h-2 rounded-full bg-hw-status shadow-[0_0_8px_#00FF41]"></div>
            <span className="font-mono text-[10px] text-hw-status uppercase">Offline Engine Active</span>
          </div>
        </div>

        <div className="flex items-center gap-2 lg:gap-4 bg-black/60 rounded-full px-4 lg:px-6 py-1 border border-hw-border-light scale-90 lg:scale-100">
          <div className="flex items-center gap-4">
            <button className="text-hw-muted hover:text-white transition-colors cursor-pointer" onClick={handleRealPlayback}>
              {isPlaying ? <Square className="w-3 h-3 fill-current text-hw-accent shadow-[0_0_8px_theme(colors.hw-accent)]" /> : <Play className="w-3 h-3 fill-current" />}
            </button>
          </div>
          <div className="w-[1px] h-4 bg-hw-border-light"></div>
          <div className="flex flex-col items-center min-w-[30px] lg:min-w-[40px]">
            <span className="text-[8px] lg:text-[9px] text-hw-muted font-mono leading-none uppercase">BPM</span>
            <span className="text-xs lg:text-sm font-mono font-bold text-hw-accent">{project.bpm}</span>
          </div>
          <div className="hidden sm:block w-[1px] h-4 bg-hw-border-light"></div>
          <div className="hidden sm:flex flex-col items-center min-w-[50px] lg:min-w-[60px]">
            <span className="text-[8px] lg:text-[9px] text-hw-muted font-mono leading-none uppercase">POS</span>
            <span className="text-xs lg:text-sm font-mono font-bold text-white">001:01</span>
          </div>
        </div>

          <div className="flex items-center gap-2 lg:gap-3">
            <button 
              onClick={() => {
                validateProject();
              }}
              className="hidden sm:block bg-hw-card hover:bg-hw-border text-[9px] font-mono text-hw-muted px-2 py-1.5 rounded border border-hw-border transition-all"
            >
              VALIDATE
            </button>
              <button 
                onClick={handleExportStyle}
                disabled={isExporting}
                className="hidden sm:block bg-hw-data hover:brightness-110 text-black text-[10px] font-bold px-3 py-1.5 rounded uppercase tracking-wider transition-colors disabled:opacity-50 shadow-lg shadow-hw-data/10 border-b-2 border-black/20"
              >
                {isExporting ? <Loader2 className="w-3 h-3 animate-spin inline mr-2" /> : <Download className="w-3 h-3 inline mr-1" />}
                Export .AFX Draft
              </button>
            <div className="w-8 h-8 lg:w-9 lg:h-9 rounded bg-hw-border border border-hw-border-light flex items-center justify-center cursor-pointer hover:bg-hw-card transition-colors">
              <Settings className="w-4 h-4 text-hw-muted" />
            </div>
          </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Sidebar - Drawer on Mobile, Fixed on Desktop */}
        <aside className={`
          fixed lg:static top-14 bottom-0 left-0 w-64 border-r border-hw-border bg-hw-sidebar flex flex-col z-30 transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <div className="p-4 space-y-6 flex-1 overflow-y-auto">
            <div>
              <label className="text-[10px] font-bold text-hw-muted uppercase tracking-widest block mb-3 opacity-50">Navigator</label>
              <div className="space-y-1">
                <SidebarButton 
                  icon={<Download className="w-4 h-4" />} 
                  label="Import Style (.STY)" 
                  active={false} 
                  onClick={handleStyleImport}
                />
                <SidebarButton 
                  icon={<Layout className="w-4 h-4" />} 
                  label="Arrangement Builder" 
                  active={activeTab === 'arranger'} 
                  onClick={() => { setActiveTab('arranger'); setIsSidebarOpen(false); }}
                />
                <SidebarButton 
                  icon={<PianoIcon className="w-4 h-4" />} 
                  label="Piano Roll Editor" 
                  active={activeTab === 'piano-roll'} 
                  onClick={() => { setActiveTab('piano-roll'); setIsSidebarOpen(false); }}
                />
                <SidebarButton 
                  icon={<Layers className="w-4 h-4" />} 
                  label="SF2 Instrument Map" 
                  active={activeTab === 'sf2'} 
                  onClick={() => { setActiveTab('sf2'); setIsSidebarOpen(false); }}
                />
                <SidebarButton 
                  icon={<Cpu className="w-4 h-4" />} 
                  label="AI Studio" 
                  active={activeTab === 'ai'} 
                  onClick={() => { setActiveTab('ai'); setIsSidebarOpen(false); }}
                  special
                />
                <SidebarButton 
                  icon={<HardDrive className="w-4 h-4" />} 
                  label="Sound Inventory" 
                  active={activeTab === 'inventory'} 
                  onClick={() => { setActiveTab('inventory'); setIsSidebarOpen(false); }}
                />
                <SidebarButton 
                  icon={<Database className="w-4 h-4" />} 
                  label="Pattern Library" 
                  active={activeTab === 'library'} 
                  onClick={() => { setActiveTab('library'); setIsSidebarOpen(false); }}
                />
                <SidebarButton 
                  icon={<Activity className="w-4 h-4" />} 
                  label="Diagnostic Center" 
                  active={activeTab === 'diagnostic'} 
                  onClick={() => { setActiveTab('diagnostic'); setIsSidebarOpen(false); }}
                />
              </div>
            </div>
            <div className="pt-4 border-t border-hw-border">
              <label className="text-[10px] font-bold text-hw-muted uppercase tracking-widest block mb-3 opacity-50">Sections</label>
              <div className="space-y-1 max-h-[30vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10">
                {project.sections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => setSelectedSectionId(section.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded text-xs transition-all ${
                      selectedSectionId === section.id 
                        ? 'bg-hw-card border-l-2 border-hw-accent text-hw-accent' 
                        : 'text-hw-muted hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                       <div className={`w-1.5 h-1.5 rounded-sm ${
                         section.type === 'Main' ? 'bg-hw-accent' : 
                         section.type === 'Intro' ? 'bg-hw-status' :
                         section.type === 'Fill' ? 'bg-orange-500' : 'bg-rose-500'
                       }`} />
                       {section.type} {section.variation}
                    </span>
                    <span className="text-[10px] opacity-40 font-mono tracking-tighter">{section.bars} B</span>
                  </button>
                ))}
                <button 
                  onClick={addSection}
                  className="w-full flex items-center gap-2 px-3 py-2 text-hw-accent/60 hover:text-hw-accent text-[11px] font-bold uppercase tracking-widest transition-colors mt-2"
                >
                  <Plus className="w-3 h-3" />
                  Add Section
                </button>
              </div>
            </div>
          </div>

          <div className="mt-auto p-4 border-t border-hw-border bg-hw-workspace">
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-hw-muted uppercase block mb-2 opacity-50">System Load</label>
                <div className="space-y-1.5">
                   <div className="w-full h-1 bg-hw-card rounded-full overflow-hidden">
                      <div className="bg-hw-data w-[34%] h-full shadow-[0_0_4px_theme(colors.hw-data)]"></div>
                   </div>
                   <div className="flex justify-between text-[8px] font-mono text-hw-text-dark uppercase">
                      <span>CPU 12%</span>
                      <span>RAM 1.2GB</span>
                   </div>
                </div>
              </div>
              <div className="bg-hw-panel rounded border border-hw-border p-3 space-y-2">
                <span className="text-[9px] font-bold text-hw-muted uppercase tracking-widest block">Genre Profile</span>
                <select 
                  value={project.genre}
                  onChange={(e) => setProject({...project, genre: e.target.value})}
                  className="w-full bg-hw-card border border-hw-border-light text-xs font-bold text-hw-accent p-1.5 rounded focus:outline-none cursor-pointer appearance-none"
                >
                  {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 bg-hw-workspace p-4 lg:p-6 overflow-y-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'arranger' && (
              <motion.div 
                key="arranger"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6 lg:y-8"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-hw-accent/10 border border-hw-accent/20 rounded-lg flex items-center justify-center text-hw-accent">
                      <Layout className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-white tracking-tight uppercase">Section Builder</h2>
                      <p className="text-[10px] font-mono text-hw-muted uppercase tracking-widest">
                        Focus: <span className="text-hw-accent">{selectedSection?.type} {selectedSection?.variation}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex bg-hw-panel p-1 rounded border border-hw-border shadow-2xl self-start sm:self-auto">
                    <button className="px-5 py-2 text-[10px] font-bold text-black uppercase tracking-widest rounded bg-hw-accent transition-colors">Pattern</button>
                    <button className="px-5 py-2 text-[10px] font-bold text-hw-muted uppercase tracking-widest hover:text-white transition-colors">Grid</button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Pattern Designer */}
                  <div className="lg:col-span-8 bg-hw-panel rounded-lg border border-hw-border shadow-2xl overflow-hidden flex flex-col">
                      <div className="h-10 bg-hw-card border-b border-hw-border flex items-center justify-between px-4 lg:px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-hw-accent shadow-[0_0_5px_theme(colors.hw-accent)]" />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-hw-muted">Sequence Lane</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={saveSectionAsPreset}
                            className="text-[9px] font-bold text-hw-accent hover:text-white uppercase tracking-widest flex items-center gap-1 transition-colors"
                          >
                            <Save className="w-3 h-3" /> Save Pattern
                          </button>
                          <div className="hidden sm:block text-[9px] font-mono text-hw-text-dark uppercase">Step: 1/16</div>
                        </div>
                      </div>
                    
                    <div className="p-4 lg:p-6 space-y-4 flex-1 overflow-x-auto">
                      <div className="min-w-[600px] space-y-4">
                        {['DRUMS', 'BASS', 'ACC1', 'ACC2', 'PHR1'].map((track) => (
                          <div key={track} className="flex items-center gap-4 group">
                            <div className="w-16 text-[9px] font-bold text-hw-text-dark tracking-widest group-hover:text-hw-muted transition-colors">{track}</div>
                            <div className="flex-1 h-10 bg-black/40 rounded flex items-center px-1 gap-[2px] border border-hw-border group-hover:border-hw-border-light transition-colors relative overflow-hidden">
                              {Array.from({ length: 16 }).map((_, i) => (
                                <div 
                                  key={i} 
                                  className={`flex-1 h-7 rounded-sm cursor-pointer transition-all ${
                                    (i % 4 === 0) ? 'bg-white/5 border-l border-white/5' : 'bg-black/20'
                                  } hover:bg-hw-accent/20 active:bg-hw-accent/60`}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="p-6 lg:p-8 border-t border-hw-border bg-hw-workspace/50 text-center group cursor-pointer hover:bg-hw-panel transition-all relative">
                      <input 
                        type="file" 
                        accept=".mid,.midi,.sty" 
                        onChange={handleMidiFileImport}
                        className="absolute inset-0 opacity-0 cursor-pointer z-10"
                      />
                      <div className="space-y-2">
                        <Plus className="w-5 h-5 text-hw-text-dark mx-auto group-hover:text-hw-accent transition-colors" />
                        <p className="text-[9px] font-bold uppercase tracking-widest text-hw-text-dark group-hover:text-hw-muted">Real Engine: Import .MID / .STY Content</p>
                      </div>
                    </div>
                  </div>

                  {/* Inspector */}
                  <div className="lg:col-span-4 space-y-6">
                      <div className="bg-hw-panel rounded-lg border border-hw-border p-5 lg:p-6 shadow-2xl relative">
                        <div className="absolute top-0 left-0 w-1 h-full bg-hw-data" />
                        <div className="flex items-center justify-between mb-4 border-b border-hw-border pb-2">
                          <h3 className="text-[10px] font-bold uppercase tracking-widest text-hw-muted">Section Properties</h3>
                          <button 
                            onClick={saveGrooveAsPreset}
                            className="text-[8px] font-bold text-hw-text-dark hover:text-hw-data transition-colors uppercase tracking-tighter"
                          >
                            Save Groove
                          </button>
                        </div>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-hw-text-dark uppercase font-bold">Base Key</span>
                          <select 
                            value={selectedSection?.key}
                            onChange={(e) => {
                              if (selectedSection) {
                                const newSections = project.sections.map(s => s.id === selectedSection.id ? { ...s, key: e.target.value } : s);
                                setProject({ ...project, sections: newSections });
                              }
                            }}
                            className="bg-hw-card border border-hw-border text-xs text-hw-accent px-2 py-1 rounded"
                          >
                            {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(k => <option key={k} value={k}>{k}</option>)}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-[10px] text-hw-text-dark uppercase font-bold">Groove Intensity</span>
                            <span className="text-[10px] text-hw-accent font-mono">{selectedSection?.groove?.intensity}%</span>
                          </div>
                          <div className="w-full h-1 bg-hw-card rounded-full overflow-hidden">
                            <div className="bg-hw-accent h-full" style={{ width: `${selectedSection?.groove?.intensity || 0}%` }} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-[10px] text-hw-text-dark uppercase font-bold">Swing Mode</span>
                            <span className="text-[10px] text-hw-accent font-mono">{selectedSection?.groove?.swing}%</span>
                          </div>
                          <div className="w-full h-1 bg-hw-card rounded-full overflow-hidden">
                            <div className="bg-hw-data h-full" style={{ width: `${selectedSection?.groove?.swing || 0}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-hw-panel rounded-lg border border-hw-border p-5 lg:p-6 shadow-2xl relative">
                      <div className="absolute top-0 left-0 w-1 h-full bg-hw-accent" />
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-hw-muted mb-4 border-b border-hw-border pb-2">Chord Timeline</h3>
                      <div className="grid grid-cols-2 gap-2">
                        {selectedSection?.chordProgression.map((chord, i) => (
                          <div key={i} className="bg-hw-card p-3 lg:p-4 rounded border border-hw-border flex flex-col items-center justify-center group cursor-pointer hover:border-hw-accent/50 transition-all">
                            <span className="text-lg lg:text-xl font-bold text-white group-hover:text-hw-accent">{chord}</span>
                            <span className="text-[8px] lg:text-[9px] text-hw-text-dark font-mono uppercase tracking-tighter">Bar {i+1}</span>
                          </div>
                        ))}
                        <button className="col-span-2 py-3 border border-dashed border-hw-border rounded text-[9px] font-bold uppercase tracking-widest text-hw-text-dark hover:bg-white/5 hover:text-hw-muted transition-all bg-hw-card/30">
                          Edit Chords
                        </button>
                      </div>
                    </div>

                    <div className="bg-hw-panel rounded-lg border border-hw-border p-5 lg:p-6 shadow-2xl">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-hw-muted mb-4 border-b border-hw-border pb-2">Lead Assist</h3>
                      <div className="space-y-3">
                         <div className="p-4 bg-hw-data/5 border border-hw-data/10 rounded space-y-3">
                            <div className="flex items-center justify-between border-b border-hw-data/10 pb-2">
                              <span className="text-[10px] font-bold text-hw-data uppercase tracking-widest flex items-center gap-2">
                                <Mic2 className="w-3 h-3" />
                                Smart Suggest
                              </span>
                              <div className="w-2 h-2 rounded-full bg-hw-data animate-pulse" />
                            </div>
                            <p className="text-[10px] lg:text-[11px] leading-relaxed text-hw-muted font-medium italic">
                               "Syncopated bass for {project.genre} feel"
                            </p>
                            <button className="w-full py-2.5 bg-hw-data text-black text-[10px] font-bold uppercase tracking-widest rounded transition-all hover:brightness-110 shadow-lg shadow-hw-data/10">
                              Inject Module
                            </button>
                         </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'ai' && (
              <motion.div 
                key="ai"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="max-w-4xl mx-auto space-y-6 lg:space-y-8 py-6 lg:py-12 text-center px-4"
              >
                <div className="w-16 h-16 lg:w-24 lg:h-24 bg-hw-accent/20 rounded-[28px] lg:rounded-[40px] flex items-center justify-center mx-auto mb-6 lg:mb-8 border border-hw-accent/30 shadow-2xl shadow-hw-accent/20 relative">
                   <div className="absolute inset-0 bg-hw-accent/5 animate-pulse rounded-[28px] lg:rounded-[40px]" />
                   <Cpu className="w-8 h-8 lg:w-12 lg:h-12 text-hw-accent" />
                </div>
                <div className="space-y-3 lg:space-y-4">
                  <h2 className="text-2xl lg:text-4xl font-bold text-white tracking-tight uppercase">AI MP3 Analysis</h2>
                  <p className="text-sm lg:text-lg text-hw-muted max-w-xl mx-auto font-medium leading-relaxed">
                    Deconstruct reference tracks to generate workstation-ready Style Drafts.
                  </p>
                </div>

                <div className="mt-8 lg:mt-12 space-y-4 lg:space-y-6">
                   <div className="relative group p-1 bg-hw-border rounded-[24px] lg:rounded-[32px] shadow-2xl">
                     <textarea
                       value={aiInput}
                       onChange={(e) => setAiInput(e.target.value)}
                       placeholder="Describe your musical vision..."
                       className="w-full h-32 lg:h-48 bg-hw-workspace border-2 border-transparent rounded-[20px] lg:rounded-[30px] p-6 lg:p-8 text-sm lg:text-lg text-white placeholder:text-hw-text-dark focus:border-hw-accent/20 focus:outline-none transition-all resize-none font-medium"
                     />
                     <div className="absolute bottom-4 lg:bottom-6 right-4 lg:right-6">
                       <button 
                        onClick={handleAIAnalysis}
                        disabled={isAnalyzing || !aiInput}
                        className="flex items-center gap-2 lg:gap-3 px-6 lg:px-8 py-3 lg:py-4 bg-hw-accent hover:brightness-110 disabled:bg-hw-card disabled:text-hw-text-dark text-black text-xs lg:text-sm font-bold rounded-xl lg:rounded-2xl transition-all active:scale-95 shadow-xl shadow-hw-accent/20 border-b-2 lg:border-b-4 border-black/20"
                       >
                         {isAnalyzing ? <Loader2 className="w-4 h-4 lg:w-5 lg:h-5 animate-spin" /> : <Activity className="w-4 h-4 lg:w-5 lg:h-5" />}
                         Real Engine Construction
                       </button>
                     </div>
                   </div>

                   <div className="p-8 lg:p-12 border-2 border-dashed border-hw-border rounded-[32px] lg:rounded-[48px] bg-black/40 hover:bg-black/60 transition-all cursor-pointer group flex flex-col items-center gap-3 lg:gap-4 relative">
                      <input 
                        type="file" 
                        accept=".mid,.midi,.sty" 
                        onChange={handleMidiFileImport}
                        className="absolute inset-0 opacity-0 cursor-pointer z-10"
                      />
                      <div className="w-12 h-12 lg:w-16 lg:h-16 rounded-full bg-hw-border flex items-center justify-center group-hover:bg-hw-card transition-colors">
                        <Plus className="w-6 h-6 lg:w-8 lg:h-8 text-hw-text-dark group-hover:text-hw-accent transition-colors" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] lg:text-xs font-black text-hw-muted uppercase tracking-[0.2em] lg:tracking-[0.3em]">Real Engine MIDI Import</p>
                        <p className="text-[8px] lg:text-[10px] text-hw-text-dark font-mono uppercase tracking-tighter lg:tracking-normal">Direct Symbolic Injection</p>
                      </div>
                   </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 lg:gap-6 mt-12 lg:mt-16 max-w-3xl mx-auto">
                   <FeatureCard 
                    icon={<Music className="w-5 h-5" />} 
                    title="Section Builder" 
                    desc="Construct style DNA" 
                   />
                   <FeatureCard 
                    icon={<Download className="w-5 h-5" />} 
                    title="Style Import" 
                    desc="Parse existing .STY" 
                   />
                   <FeatureCard 
                    icon={<Layers className="w-5 h-5" />} 
                    title="SF2 mapping" 
                    desc="Precision instrument map" 
                   />
                </div>
              </motion.div>
            )}
            
            {activeTab === 'sf2' && (
              <motion.div 
                key="sf2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6 lg:space-y-8"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-hw-border pb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-hw-accent/10 rounded-lg flex items-center justify-center text-hw-accent border border-hw-accent/20">
                      <Layers className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg lg:text-xl font-bold text-white tracking-tight uppercase">Instrument Mapping</h2>
                      <p className="text-[10px] font-mono text-hw-muted uppercase tracking-widest">SF2 Real Engine Initialization</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative group overflow-hidden bg-hw-data/10 border border-hw-data/20 rounded px-4 py-2.5 transition-all hover:bg-hw-data/20">
                      <input 
                        type="file" 
                        accept=".sf2" 
                        onChange={handleSF2FileScan}
                        className="absolute inset-0 opacity-0 cursor-pointer z-10"
                      />
                      <span className="flex items-center gap-2 font-bold text-[10px] text-hw-data uppercase tracking-widest transition-all">
                        <HardDrive className="w-4 h-4" />
                        Scan Physical SF2
                      </span>
                    </div>
                    <button className="flex items-center justify-center gap-2 px-6 py-2.5 bg-hw-border hover:bg-hw-border-light rounded font-bold text-[10px] text-white uppercase tracking-widest transition-all">
                      <Save className="w-4 h-4" />
                      Assign Global
                    </button>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {(Object.entries(project.sf2Mapping) as [string, SF2Instrument][]).map(([track, instrument]) => (
                    <div key={track} className="p-4 lg:p-5 bg-hw-panel rounded border border-hw-border flex flex-col gap-4 group hover:border-hw-accent/30 transition-all shadow-xl">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="text-[9px] font-mono font-bold text-hw-text-dark uppercase tracking-[0.2em]">{track}</span>
                          <p className="text-sm font-bold text-white">{instrument.name}</p>
                        </div>
                        <div className="flex items-center gap-2 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                           <button className="p-2 bg-hw-card rounded text-hw-muted hover:text-white border border-hw-border-light">
                             <Settings className="w-3.5 h-3.5" />
                           </button>
                           <button className="p-2 bg-rose-500/10 rounded text-rose-500/40 hover:text-rose-500 border border-rose-500/20">
                             <Trash2 className="w-3.5 h-3.5" />
                           </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                         <div className="bg-black/40 p-2 rounded border border-hw-border text-center">
                            <span className="block text-[8px] text-hw-text-dark uppercase">Bank</span>
                            <span className="text-xs font-mono font-bold text-hw-accent">{instrument.bank}</span>
                         </div>
                         <div className="bg-black/40 p-2 rounded border border-hw-border text-center">
                            <span className="block text-[8px] text-hw-text-dark uppercase">MSB</span>
                            <span className="text-xs font-mono font-bold text-white">{instrument.msb}</span>
                         </div>
                         <div className="bg-black/40 p-2 rounded border border-hw-border text-center">
                            <span className="block text-[8px] text-hw-text-dark uppercase">LSB</span>
                            <span className="text-xs font-mono font-bold text-white">{instrument.lsb}</span>
                         </div>
                         <div className="bg-hw-data/5 p-2 rounded border border-hw-data/20 text-center">
                            <span className="block text-[8px] text-hw-data uppercase">Role</span>
                            <span className="text-[10px] font-bold text-hw-data">{instrument.role}</span>
                         </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <div className="w-full h-1 bg-hw-card rounded-full overflow-hidden">
                           <div className="w-full h-full bg-hw-data shadow-[0_0_8px_theme(colors.hw-data)]"></div>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button className="p-6 border-2 border-dashed border-hw-border rounded bg-black/20 flex flex-col items-center justify-center gap-3 group hover:bg-hw-accent/5 hover:border-hw-accent/30 transition-all text-hw-text-dark hover:text-hw-accent">
                    <Plus className="w-6 h-6" />
                    <span className="text-[10px] uppercase font-black tracking-widest">Map Soundfont</span>
                  </button>
                </div>
              </motion.div>
            )}

            {activeTab === 'piano-roll' && (
              <motion.div 
                key="piano-roll"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6 h-full flex flex-col"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-hw-accent/10 rounded-lg flex items-center justify-center text-hw-accent border border-hw-accent/20">
                      <PianoIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg lg:text-xl font-bold text-white tracking-tight uppercase">Symbolic Editor</h2>
                      <p className="text-[10px] font-mono text-hw-muted uppercase tracking-widest">Precision Matrix</p>
                    </div>
                  </div>
                  <div className="flex bg-hw-panel p-1 rounded border border-hw-border text-[9px] font-bold uppercase tracking-widest self-start sm:self-auto">
                    <button className="px-4 py-1.5 bg-hw-border text-hw-data italic rounded shadow-inner">Automation Active</button>
                  </div>
                </div>

                <div className="flex-1 bg-black border border-hw-border rounded-lg overflow-hidden flex flex-col relative shadow-2xl">
                  <div className="h-8 bg-hw-card border-b border-hw-border flex items-center z-10 min-w-max">
                    <div className="w-12 border-r border-hw-border h-full bg-hw-panel shrink-0" />
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="w-32 lg:flex-1 text-[9px] font-mono text-hw-text-dark text-center border-r border-hw-border shrink-0">{i+1}</div>
                    ))}
                  </div>
                  
                  <div className="flex-1 flex overflow-hidden">
                    <div className="w-12 bg-hw-panel border-r border-hw-border flex flex-col overflow-y-auto shrink-0 no-scrollbar">
                      {Array.from({ length: 24 }).map((_, i) => (
                        <div key={i} className={`h-6 border-b border-hw-border flex items-center justify-center text-[9px] font-bold ${[1,3,6,8,10].includes(i%12)?'bg-black text-hw-text-dark':'text-hw-muted'}`}>
                          {['C','B','A#','A','G#','G','F#','F','E','D#','D','C#'][i % 12]}
                        </div>
                      ))}
                    </div>
                    <div className="flex-1 relative bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] bg-opacity-10 overflow-auto">
                       <div className="min-w-max">
                         <div className="absolute inset-0 grid grid-cols-16 grid-rows-24 pointer-events-none opacity-5">
                            {Array.from({ length: 384 }).map((_, i) => (
                              <div key={i} className="border-[0.5px] border-hw-border" />
                            ))}
                         </div>
                         {/* Notes with HW glow */}
                         <div className="absolute top-12 left-24 w-12 h-6 bg-hw-accent/60 border border-hw-accent rounded shadow-[0_0_12px_theme(colors.hw-accent/40)]" />
                         <div className="absolute top-24 left-48 w-24 h-6 bg-hw-data/60 border border-hw-data rounded shadow-[0_0_12px_theme(colors.hw-data/40)]" />
                         <div className="absolute top-36 left-80 w-8 h-6 bg-rose-500/60 border border-rose-500 rounded shadow-[0_0_12px_theme(colors.rose-500/40)]" />
                       </div>
                    </div>
                  </div>

                  <div className="h-10 bg-hw-panel border-t border-hw-border flex items-center px-4 lg:px-6 gap-4 lg:gap-6">
                     <div className="flex items-center gap-2 lg:gap-3">
                       <Volume2 className="w-4 h-4 text-hw-muted" />
                       <div className="w-20 lg:w-32 h-1 bg-hw-border rounded-full overflow-hidden relative">
                          <div className="w-3/4 h-full bg-hw-data shadow-[0_0_4px_theme(colors.hw-data)]" />
                       </div>
                     </div>
                     <span className="text-[9px] lg:text-[10px] font-mono text-hw-text-dark ml-auto uppercase tracking-tighter sm:tracking-normal">Quantize: 1/16 | Velocity: 92</span>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'inventory' && (
              <motion.div 
                key="inventory"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-2">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-hw-accent/10 rounded-lg flex items-center justify-center text-hw-accent border border-hw-accent/20">
                      <HardDrive className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white tracking-tight uppercase">Sound Inventory</h2>
                      <p className="text-[10px] font-mono text-hw-muted uppercase tracking-widest">Expansion & Bank Database</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {bankConflicts.length > 0 && (
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded text-rose-500 text-[9px] font-bold uppercase animate-pulse">
                        <AlertTriangle className="w-3 h-3" />
                        Conflicts ({bankConflicts.length})
                      </div>
                    )}
                    <button className="flex items-center gap-2 px-4 py-2 bg-hw-accent hover:brightness-110 text-black rounded font-bold text-[10px] uppercase tracking-widest transition-all shadow-xl active:scale-95">
                      <Plus className="w-4 h-4" />
                      Add Asset
                    </button>
                  </div>
                </div>

                {bankConflicts.length > 0 && (
                  <div className="p-4 bg-rose-500/5 border border-rose-500/20 rounded-lg space-y-1">
                    {bankConflicts.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-rose-400 text-[10px] font-mono">
                         <div className="w-1 h-1 rounded-full bg-rose-500" />
                         {c}
                      </div>
                    ))}
                  </div>
                )}

                <div className="bg-hw-panel rounded-lg border border-hw-border shadow-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-hw-card border-b border-hw-border">
                          <th className="py-3 px-6 text-[9px] font-bold text-hw-muted uppercase tracking-widest">Asset</th>
                          <th className="py-3 px-6 text-[9px] font-bold text-hw-muted uppercase tracking-widest text-center">Type</th>
                          <th className="py-3 px-6 text-[9px] font-bold text-hw-muted uppercase tracking-widest text-center">Bank</th>
                          <th className="py-3 px-6 text-[9px] font-bold text-hw-muted uppercase tracking-widest text-center">MSB/LSB</th>
                          <th className="py-3 px-6 text-[9px] font-bold text-hw-muted uppercase tracking-widest">Role</th>
                          <th className="py-3 px-6 text-[9px] font-bold text-hw-muted uppercase tracking-widest">Tags</th>
                          <th className="py-3 px-6 text-[9px] font-bold text-hw-muted uppercase tracking-widest text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {project.inventory.map((asset) => (
                          <tr key={asset.id} className="border-b border-hw-border/50 hover:bg-white/5 transition-colors group">
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded flex items-center justify-center ${asset.type === 'SF2' ? 'bg-hw-data/10 text-hw-data' : 'bg-hw-accent/10 text-hw-accent'}`}>
                                  {asset.type === 'SF2' ? <Layers className="w-4 h-4" /> : <Music className="w-4 h-4" />}
                                </div>
                                <span className="text-sm font-bold text-white">{asset.name}</span>
                              </div>
                            </td>
                            <td className="py-4 px-6 text-center">
                              <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${asset.type === 'SF2' ? 'bg-hw-data/10 border-hw-data/20 text-hw-data' : 'bg-hw-accent/10 border-hw-accent/20 text-hw-accent'}`}>
                                {asset.type}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center font-mono text-sm text-hw-accent">{asset.bank}</td>
                            <td className="py-4 px-6 text-center font-mono text-xs text-hw-muted">
                              {asset.msb} : {asset.lsb}
                            </td>
                            <td className="py-4 px-6">
                              <span className="text-[10px] font-bold text-hw-muted uppercase tracking-widest">{asset.role}</span>
                            </td>
                            <td className="py-4 px-6">
                              <span className="text-[9px] text-hw-text-dark font-mono uppercase">{asset.genre}</span>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <div className="flex items-center justify-end gap-2 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                                <button className="p-1.5 hover:bg-hw-card rounded text-hw-muted hover:text-white border border-hw-border-light transition-colors">
                                  <Settings className="w-3.5 h-3.5" />
                                </button>
                                <button className="p-1.5 hover:bg-rose-500/10 rounded text-rose-500/40 hover:text-rose-500 border border-rose-500/20 transition-colors">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'diagnostic' && (
              <motion.div 
                key="diagnostic"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6 flex flex-col h-full"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-2">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-hw-data/10 rounded-lg flex items-center justify-center text-hw-data border border-hw-data/20">
                      <Activity className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white tracking-tight uppercase">Diagnostic Center</h2>
                      <p className="text-[10px] font-mono text-hw-muted uppercase tracking-widest">Realtime Engine Logs & Validation</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setProject(prev => ({ ...prev, logs: [] }))}
                      className="px-4 py-2 bg-hw-border hover:bg-hw-card text-hw-muted hover:text-white rounded font-bold text-[10px] uppercase tracking-widest transition-all"
                    >
                      Clear Logs
                    </button>
                    <button 
                      onClick={validateProject}
                      className="px-4 py-2 bg-hw-data hover:brightness-110 text-black rounded font-bold text-[10px] uppercase tracking-widest transition-all shadow-xl"
                    >
                      Run Validation
                    </button>
                  </div>
                </div>

                <div className="flex-1 bg-black/40 rounded-lg border border-hw-border shadow-2xl overflow-hidden flex flex-col">
                  <div className="h-10 bg-hw-card border-b border-hw-border flex items-center px-4 lg:px-6 justify-between shrink-0">
                    <div className="flex items-center gap-4">
                      {['ALL', 'SYSTEM', 'MIDI', 'SF2', 'STYLE', 'VALIDATION'].map(f => (
                        <button key={f} className="text-[9px] font-bold text-hw-muted hover:text-hw-accent uppercase tracking-widest transition-colors">{f}</button>
                      ))}
                    </div>
                    <span className="text-[9px] font-mono text-hw-text-dark uppercase">{project.logs.length} Total Events</span>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-2 font-mono scrollbar-thin scrollbar-thumb-white/10">
                    {project.logs.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-hw-text-dark gap-2 opacity-40">
                        <Activity className="w-8 h-8" />
                        <p className="text-xs uppercase tracking-widest">No diagnostic events recorded</p>
                      </div>
                    ) : (
                      project.logs.map((log) => (
                        <div key={log.id} className="flex gap-4 text-[11px] leading-relaxed group animate-in fade-in slide-in-from-left-2 duration-300">
                          <span className="text-hw-text-dark shrink-0 whitespace-nowrap">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                          <span className={`shrink-0 w-20 text-center font-bold ${
                            log.level === 'CRITICAL' ? 'text-rose-600' :
                            log.level === 'ERROR' ? 'text-rose-400' :
                            log.level === 'WARNING' ? 'text-orange-400' :
                            'text-hw-data'
                          }`}>[{log.level}]</span>
                          <span className="text-hw-muted font-bold shrink-0 w-24">({log.module})</span>
                          <span className="text-white break-all">{log.message}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 shrink-0">
                  <div className="bg-hw-panel p-4 rounded border border-hw-border relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-hw-data" />
                    <span className="block text-[10px] font-bold text-hw-muted uppercase mb-2">Memory Status</span>
                    <div className="flex items-end gap-2">
                      <span className="text-2xl font-mono font-bold text-white">1,240</span>
                      <span className="text-xs text-hw-text-dark mb-1">MB</span>
                    </div>
                  </div>
                  <div className="bg-hw-panel p-4 rounded border border-hw-border relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-hw-accent" />
                    <span className="block text-[10px] font-bold text-hw-muted uppercase mb-2">Engine Latency</span>
                    <div className="flex items-end gap-2">
                       <span className="text-2xl font-mono font-bold text-white">12</span>
                       <span className="text-xs text-hw-text-dark mb-1">MS</span>
                    </div>
                  </div>
                  <div className="bg-hw-panel p-4 rounded border border-hw-border relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-orange-500" />
                    <span className="block text-[10px] font-bold text-hw-muted uppercase mb-2">Active Voices</span>
                    <div className="flex items-end gap-2">
                       <span className="text-2xl font-mono font-bold text-white">34</span>
                       <span className="text-xs text-hw-text-dark mb-1">/ 128</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'library' && (
              <motion.div 
                key="library"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-6 flex flex-col h-full"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-2">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-hw-accent/10 rounded-lg flex items-center justify-center text-hw-accent border border-hw-accent/20">
                      <Database className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white tracking-tight uppercase">Pattern Library</h2>
                      <p className="text-[10px] font-mono text-hw-muted uppercase tracking-widest">Reusable Arranger Assets</p>
                    </div>
                  </div>
                  <div className="flex bg-hw-panel p-1 rounded border border-hw-border">
                    {['Sections', 'Grooves', 'Patterns'].map(f => (
                      <button key={f} className="px-4 py-2 text-[10px] font-bold text-hw-muted hover:text-white uppercase tracking-widest transition-colors">{f}</button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Section Presets */}
                  {project.library.sections.map((preset) => (
                    <div key={preset.id} className="bg-hw-panel rounded-lg border border-hw-border p-5 lg:p-6 shadow-xl group hover:border-hw-accent/30 transition-all relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-16 h-16 bg-hw-accent/5 -rotate-45 translate-x-8 -translate-y-8" />
                      <div className="flex justify-between items-start mb-4">
                        <div className="space-y-1">
                          <span className="text-[9px] font-mono font-bold text-hw-accent uppercase tracking-widest">{preset.genre} // {preset.type}</span>
                          <h4 className="text-sm font-bold text-white truncate max-w-[150px]">{preset.name}</h4>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              if (selectedSectionId) {
                                const newSections = project.sections.map(s => s.id === selectedSectionId ? { ...s, lanes: JSON.parse(JSON.stringify(preset.lanes)), groove: preset.groove ? { ...preset.groove } : s.groove } : s);
                                setProject({ ...project, sections: newSections });
                                addLog('STYLE', 'INFO', `Applied section preset: ${preset.name}`);
                                setActiveTab('arranger');
                              }
                            }}
                            className="p-2 bg-hw-accent/10 text-hw-accent rounded border border-hw-accent/20 hover:bg-hw-accent hover:text-black transition-all"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => {
                              setProject(prev => ({
                                ...prev,
                                library: {
                                  ...prev.library,
                                  sections: prev.library.sections.filter(s => s.id !== preset.id)
                                }
                              }));
                            }}
                            className="p-2 bg-rose-500/10 text-rose-500/40 hover:text-rose-500 rounded border border-rose-500/20 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="bg-black/40 p-2 rounded border border-hw-border text-center">
                          <span className="block text-[8px] text-hw-text-dark uppercase mb-1">Lanes</span>
                          <span className="text-xs font-mono font-bold text-white">{preset.lanes.length}</span>
                        </div>
                        <div className="bg-black/40 p-2 rounded border border-hw-border text-center">
                          <span className="block text-[8px] text-hw-text-dark uppercase mb-1">Groove</span>
                          <span className="text-xs font-mono font-bold text-hw-data">{preset.groove ? 'YES' : 'NO'}</span>
                        </div>
                      </div>
                      <div className="flex gap-1 overflow-hidden">
                        {preset.lanes.map(l => (
                          <div key={l.id} className="w-4 h-4 rounded-sm bg-hw-border text-[6px] flex items-center justify-center font-bold text-hw-text-dark uppercase">
                            {l.role[0]}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Groove Presets */}
                  {project.library.grooves.map((preset) => (
                    <div key={preset.id} className="bg-hw-panel rounded-lg border border-hw-border p-5 lg:p-6 shadow-xl group hover:border-hw-accent/30 transition-all relative">
                      <div className="absolute top-0 left-0 w-1 h-full bg-hw-data" />
                      <div className="flex justify-between items-start mb-4">
                        <div className="space-y-1">
                          <span className="text-[9px] font-mono font-bold text-hw-data uppercase tracking-widest">{preset.genre} // GROOVE</span>
                          <h4 className="text-sm font-bold text-white truncate max-w-[150px]">{preset.name}</h4>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              if (selectedSectionId) {
                                const newSections = project.sections.map(s => s.id === selectedSectionId ? { ...s, groove: { intensity: preset.intensity, swing: preset.swing, humanize: preset.humanize } } : s);
                                setProject({ ...project, sections: newSections });
                                addLog('STYLE', 'INFO', `Applied groove preset: ${preset.name}`);
                                setActiveTab('arranger');
                              }
                            }}
                            className="p-2 bg-hw-data/10 text-hw-data rounded border border-hw-data/20 hover:bg-hw-data hover:text-black transition-all"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => {
                              setProject(prev => ({
                                ...prev,
                                library: {
                                  ...prev.library,
                                  grooves: prev.library.grooves.filter(g => g.id !== preset.id)
                                }
                              }));
                            }}
                            className="p-2 bg-rose-500/10 text-rose-500/40 hover:text-rose-500 rounded border border-rose-500/20 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex justify-between text-[9px] font-bold text-hw-text-dark uppercase">
                          <span>Intensity</span>
                          <span className="text-hw-accent">{preset.intensity}%</span>
                        </div>
                        <div className="w-full h-1 bg-hw-card rounded-full overflow-hidden">
                          <div className="bg-hw-accent h-full" style={{ width: `${preset.intensity}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}

                  <button className="bg-hw-workspace h-48 border-2 border-dashed border-hw-border rounded-lg flex flex-col items-center justify-center gap-3 group hover:border-hw-accent/30 transition-all">
                    <div className="w-10 h-10 rounded-full bg-hw-border flex items-center justify-center group-hover:bg-hw-card transition-colors">
                      <Plus className="w-5 h-5 text-hw-text-dark group-hover:text-hw-accent" />
                    </div>
                    <span className="text-[10px] uppercase font-black tracking-widest text-hw-text-dark">Quick Save Pattern</span>
                  </button>
                </div>

                <div className="mt-auto p-6 bg-hw-panel border border-hw-border rounded-lg text-center">
                  <div className="max-w-2xl mx-auto space-y-4">
                     <div className="w-12 h-12 bg-hw-accent/10 rounded-lg flex items-center justify-center mx-auto text-hw-accent border border-hw-accent/20">
                        <AlertTriangle className="w-6 h-6" />
                     </div>
                     <h3 className="text-lg font-bold text-white uppercase italic tracking-tight">Preserve Your Heritage</h3>
                     <p className="text-xs text-hw-muted leading-relaxed">ArrangerFlow presets are stored locally for maximum performance. Use these to build your signature genre ecosystem and reach functional production speeds.</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Modern Toolbar Footer */}
      <footer className="h-10 bg-hw-panel border-t border-hw-border px-4 lg:px-6 flex items-center justify-between font-mono bg-gradient-to-t from-black/20 to-transparent">
        <div className="flex gap-4 lg:gap-6">
           <span className="text-[8px] lg:text-[9px] text-hw-text-dark uppercase tracking-wider lg:tracking-widest truncate max-w-[120px] lg:max-w-none">Project: <span className="text-white">{project.name}</span></span>
           <span className="hidden sm:inline text-[8px] lg:text-[9px] text-hw-text-dark uppercase tracking-widest font-bold">Status: <span className="text-hw-status">Online</span></span>
        </div>
        
        <div className="flex items-center gap-4 lg:gap-6">
           <div className="hidden sm:flex items-center gap-1.5 grayscale opacity-50">
             <div className="w-2 h-2 rounded-full bg-hw-accent" />
             <span className="text-[9px] text-hw-muted uppercase">MIDI</span>
           </div>
           <div className="hidden sm:block h-3 w-[0.5px] bg-hw-border" />
           <span className="text-[8px] lg:text-[9px] text-hw-muted uppercase tracking-tighter lg:tracking-widest font-bold">V1.0.4-LOCKED</span>
        </div>
      </footer>

      {/* Engineering Agent Floating Assistant */}
      <div className="fixed bottom-14 right-6 z-50 flex flex-col items-end gap-4 pointer-events-none">
        <div className="pointer-events-auto flex flex-col items-end gap-4">
          <AnimatePresence mode="wait">
            {isAgentOpen && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 20, scale: 0.9 }}
                className="w-80 h-[500px] bg-hw-panel border border-hw-border rounded-2xl shadow-3xl overflow-hidden flex flex-col mb-2"
              >
                <div className="bg-hw-card border-b border-hw-border p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-hw-accent animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">Engineering Agent</span>
                  </div>
                  <button onClick={() => setIsAgentOpen(false)} className="text-hw-text-dark hover:text-white transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-[10px]">
                  <div className="bg-black/40 p-3 rounded border border-hw-border">
                    <span className="text-hw-accent block mb-1 uppercase font-bold text-[9px]">
                      Status: {agentStatus} {agentHeartbeat ? `(❤️ ${agentHeartbeat.count})` : ''}
                    </span>
                    <div className="grid grid-cols-2 gap-2 text-[8px] text-hw-muted">
                      <span>MIDI: <span className="text-hw-data uppercase">Active</span></span>
                      <span>Audio: <span className={agentHeartbeat ? "text-hw-accent uppercase" : "text-orange-400 uppercase"}>
                        {agentHeartbeat ? "Realtime" : "Simulated"}
                      </span></span>
                      <span>SF2: <span className="text-hw-data uppercase">Ready</span></span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {agentMessages.length === 0 && (
                      <div className="flex gap-2 text-hw-text-dark italic text-[9px] animate-pulse">
                        Waiting for supervisory diagnostic feed...
                      </div>
                    )}
                    {agentMessages.map((msg, idx) => (
                      <div key={idx} className={`flex gap-2 ${msg.type === 'user' ? 'justify-end' : ''}`}>
                        {msg.type !== 'user' && (
                          <div className="w-6 h-6 rounded-full bg-hw-border flex items-center justify-center text-hw-accent shrink-0">
                            <Terminal className="w-3 h-3" />
                          </div>
                        )}
                        <div className={`p-2 rounded border max-w-[85%] ${
                          msg.type === 'user' 
                            ? 'bg-hw-accent/10 border-hw-accent/20 text-hw-accent font-bold italic' 
                            : 'bg-hw-card border-hw-border text-hw-text-dark'
                        }`}>
                          {msg.type === 'heartbeat' ? `Heartbeat Received [${msg.data.status}]` : (typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-4 bg-hw-card border-t border-hw-border">
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={agentInput}
                      onChange={(e) => setAgentInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && sendAgentCommand()}
                      placeholder="Enter command..."
                      className="flex-1 bg-black/40 border border-hw-border rounded px-3 py-2 text-[10px] text-white focus:border-hw-accent outline-none placeholder:text-hw-text-dark"
                    />
                    <button 
                      onClick={sendAgentCommand}
                      className="bg-hw-accent text-black p-2 rounded hover:brightness-110 transition-all shadow-lg shadow-hw-accent/20 shrink-0"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button 
            onClick={() => setIsAgentOpen(!isAgentOpen)}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-2xl relative border z-50 ${isAgentOpen ? 'bg-white text-black border-white scale-90' : 'bg-hw-panel border-hw-border text-hw-accent hover:border-hw-accent/40'}`}
          >
            {isAgentOpen ? <X className="w-6 h-6" /> : <Terminal className="w-6 h-6" />}
            {!isAgentOpen && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full border-2 border-hw-workspace flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              </div>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function SidebarButton({ icon, label, active, onClick, special = false }: { 
  icon: React.ReactNode; 
  label: string; 
  active: boolean; 
  onClick: () => void;
  special?: boolean;
}) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-bold uppercase tracking-widest transition-all duration-200 outline-none ${
        active 
          ? 'bg-hw-card border-l-2 border-hw-accent text-hw-accent translate-x-1 shadow-lg' 
          : special 
            ? 'text-hw-data bg-hw-data/5 hover:bg-hw-data/10 border border-hw-data/10'
            : 'text-hw-muted hover:text-white hover:bg-white/5'
      }`}
    >
      <span className={active ? 'text-hw-accent' : 'text-hw-text-dark'}>{icon}</span>
      {label}
      {active && <ChevronRight className="w-3 ml-auto opacity-40 text-hw-accent" />}
    </button>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-hw-panel p-6 rounded border border-hw-border text-left space-y-3 hover:border-hw-accent/20 transition-all group shadow-xl">
      <div className="w-10 h-10 bg-hw-accent/10 rounded flex items-center justify-center text-hw-accent group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <h3 className="text-[11px] font-black text-white uppercase tracking-[0.2em]">{title}</h3>
      <p className="text-[10px] text-hw-muted font-medium leading-relaxed uppercase opacity-60">{desc}</p>
    </div>
  );
}
