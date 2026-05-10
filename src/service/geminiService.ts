import { GoogleGenAI } from "@google/genai";
import { Project } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function analyzeTrackIdeas(description: string, genre: string): Promise<Partial<Project>> {
  const prompt = `
    You are an expert Music Arranger and Keyboard Style Creator. 
    Analyze the following musical description and genre:
    Genre: ${genre}
    Description: ${description}

    Create a structured "Style Draft" including:
    1. BPM suggestion.
    2. A list of sections (Intro, Main Variations A-D, Fills).
    3. For each section, provide a typical chord progression and bar count.
    
    Return the result purely as a JSON object matching this structure:
    {
      "name": "Generated Project Name",
      "bpm": number,
      "sections": [
        {
          "type": "Intro" | "Main" | "Fill" | "Ending",
          "variation": "A" | "B" | "C" | "D",
          "bars": number,
          "chordProgression": string[]
        }
      ],
      "analysis": "Brief 1-sentence analysis of the style"
    }
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt
    });
    
    const text = response.text;
    if (!text) throw new Error("Empty response from AI");

    // Improved JSON extraction
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse AI response");
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("Gemini analysis failed:", error);
    throw error;
  }
}
