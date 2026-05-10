export type SectionType = 'Intro' | 'Main' | 'Fill' | 'Ending';
export type Variation = 'A' | 'B' | 'C' | 'D';

export interface MidiNote {
  pitch: number;
  velocity: number;
  start: number; // in ticks or ratio
  duration: number;
}

export interface StyleLane {
  id: string;
  role: 'Drum' | 'Bass' | 'Lead' | 'Pad' | 'Acc';
  midiChannel: number;
  muted: boolean;
  notes: MidiNote[];
}

export interface StyleSection {
  id: string;
  type: SectionType;
  variation?: Variation;
  bars: number;
  tempo: number;
  key: string;
  chordProgression: string[];
  groove?: {
    intensity: number;
    swing: number;
    humanize: number;
  };
  lanes: StyleLane[];
}

export interface SF2Instrument {
  name: string;
  bank: number;
  msb: number;
  lsb: number;
  role: 'Drum' | 'Bass' | 'Lead' | 'Pad' | 'Acc';
  type: 'SF2' | 'WAV';
}

export interface SoundAsset {
  id: string;
  name: string;
  type: 'SF2' | 'WAV';
  bank: number;
  msb: number;
  lsb: number;
  role: 'Drum' | 'Bass' | 'Lead' | 'Pad' | 'Acc';
  genre?: string;
  size?: string;
}

export type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
export type LogModule = 'SYSTEM' | 'MIDI' | 'SF2' | 'STYLE' | 'EXPANSION' | 'AI' | 'PREVIEW' | 'VALIDATION' | 'EXPORT';

export interface LogEntry {
  id: string;
  timestamp: string;
  module: LogModule;
  level: LogLevel;
  message: string;
  metadata?: any;
}

export interface Project {
  id: string;
  name: string;
  genre: string;
  bpm: number;
  sections: StyleSection[];
  sf2Mapping: Record<string, SF2Instrument>;
  masterKey: string;
  inventory: SoundAsset[];
  logs: LogEntry[];
  library: PresetLibrary;
}

export interface PresetLibrary {
  sections: SectionPreset[];
  grooves: GroovePreset[];
  patterns: RhythmPatternPreset[];
}

export interface SectionPreset {
  id: string;
  name: string;
  genre: string;
  type: SectionType;
  lanes: StyleLane[];
  groove?: {
    intensity: number;
    swing: number;
    humanize: number;
  };
}

export interface GroovePreset {
  id: string;
  name: string;
  genre: string;
  intensity: number;
  swing: number;
  humanize: number;
}

export interface RhythmPatternPreset {
  id: string;
  name: string;
  genre: string;
  lane: StyleLane;
}

export const GENRES = [
  'Dangdut',
  'Sunda',
  'Keroncong',
  'Pop',
  'Jawa',
  'Funk',
  'Jazz'
];

export const INITIAL_PROJECT: Project = {
  id: 'new-project',
  name: 'Untitled Style',
  genre: 'Dangdut',
  bpm: 120,
  masterKey: 'C',
  inventory: [
    { id: '1', name: 'Standard Kit', type: 'SF2', bank: 128, msb: 0, lsb: 0, role: 'Drum', genre: 'Global' },
    { id: '2', name: 'Yamaha Grand', type: 'SF2', bank: 0, msb: 0, lsb: 0, role: 'Lead', genre: 'Pop' },
    { id: '3', name: 'Dangdut Bass', type: 'SF2', bank: 0, msb: 0, lsb: 1, role: 'Bass', genre: 'Dangdut' },
    { id: '4', name: 'Koplo Loop 01', type: 'WAV', bank: 1, msb: 1, lsb: 0, role: 'Drum', genre: 'Koplo' },
  ],
  sections: [
    { 
      id: '主A', 
      type: 'Main', 
      variation: 'A', 
      bars: 4, 
      tempo: 120, 
      key: 'C', 
      chordProgression: ['C', 'G', 'Am', 'F'],
      groove: { intensity: 80, swing: 0, humanize: 5 },
      lanes: [
        { id: 'l1', role: 'Drum', midiChannel: 10, muted: false, notes: [] },
        { id: 'l2', role: 'Bass', midiChannel: 2, muted: false, notes: [] },
      ]
    },
    { 
      id: '主B', 
      type: 'Main', 
      variation: 'B', 
      bars: 4, 
      tempo: 120, 
      key: 'C', 
      chordProgression: ['F', 'G', 'C', 'C'],
      groove: { intensity: 85, swing: 5, humanize: 10 },
      lanes: [
        { id: 'l3', role: 'Drum', midiChannel: 10, muted: false, notes: [] },
        { id: 'l4', role: 'Bass', midiChannel: 2, muted: false, notes: [] },
      ]
    },
    { 
      id: 'F1', 
      type: 'Fill', 
      variation: 'A', 
      bars: 1, 
      tempo: 120, 
      key: 'C', 
      chordProgression: ['G'],
      groove: { intensity: 95, swing: 0, humanize: 15 },
      lanes: [
        { id: 'l5', role: 'Drum', midiChannel: 10, muted: false, notes: [] },
      ]
    },
  ],
  sf2Mapping: {
    'Track 1': { name: 'Acoustic Piano', bank: 0, msb: 0, lsb: 0, role: 'Lead', type: 'SF2' },
    'Track 10': { name: 'Standard Drum Kit', bank: 128, msb: 0, lsb: 0, role: 'Drum', type: 'SF2' },
  },
  logs: [
    { id: 'l1', timestamp: new Date().toISOString(), module: 'SYSTEM', level: 'INFO', message: 'ArrangerFlow Engine Initialized' },
  ],
  library: {
    sections: [
      { 
        id: 'ps1', 
        name: 'Basic Dangdut Main', 
        genre: 'Dangdut', 
        type: 'Main', 
        lanes: [{ id: 'pl1', role: 'Drum', midiChannel: 10, muted: false, notes: [] }] 
      }
    ],
    grooves: [
      { id: 'pg1', name: 'Slow Dangdut', genre: 'Dangdut', intensity: 70, swing: 0, humanize: 2 }
    ],
    patterns: []
  }
};
