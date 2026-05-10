/**
 * Gemini Service - AI analysis of musical content
 * Uses Google Generative AI for track analysis
 */

export async function analyzeTrackIdeas(input: string, genre: string): Promise<any> {
  try {
    const apiKey = process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('GEMINI_API_KEY not configured');
      return {
        sections: [
          {
            type: 'Main',
            variation: 'A',
            bars: 4,
            lanes: [
              { id: 'l1', role: 'Drum', midiChannel: 10, muted: false, notes: [] },
              { id: 'l2', role: 'Bass', midiChannel: 2, muted: false, notes: [] }
            ]
          }
        ],
        bpm: 120,
        name: 'AI Generated Style'
      };
    }

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `As a music arranger AI, analyze this ${genre} music concept and suggest symbolic arrangement structure. Response in JSON format with sections array, bpm, and name.\n\nInput: ${input}`
          }]
        }]
      })
    });

    const data = await response.json();
    const content = data.contents?.[0]?.parts?.[0]?.text || '';
    
    try {
      const jsonMatch = content.match(/\{[^{}]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Failed to parse Gemini response');
    }

    return {
      sections: [
        {
          type: 'Main',
          variation: 'A',
          bars: 4,
          lanes: []
        }
      ],
      bpm: 120
    };
  } catch (error) {
    console.error('Gemini analysis failed:', error);
    return { sections: [], bpm: 120 };
  }
}