import React, { useState, useCallback } from 'react';
import { AVAILABLE_MODELS, ModelResponse, AIModel } from './types';
import { generateModelResponse } from './services/geminiService';
import { ModelCard } from './components/ModelCard';
import { ControlPanel } from './components/ControlPanel';

export default function App() {
  const [responses, setResponses] = useState<Record<string, ModelResponse>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [gridCols, setGridCols] = useState(4); // Default to 4 columns for large screens

  const handleSearch = useCallback(async (prompt: string) => {
    setIsGenerating(true);
    
    // Initialize loading states for all models
    const initialResponses: Record<string, ModelResponse> = {};
    AVAILABLE_MODELS.forEach(model => {
      initialResponses[model.id] = {
        modelId: model.id,
        text: '',
        status: 'loading'
      };
    });
    setResponses(initialResponses);

    // Trigger requests in parallel
    // In a real app, we might stagger these or use a queue to avoid rate limits,
    // but Gemini Flash is high throughput.
    const promises = AVAILABLE_MODELS.map(async (model) => {
      const startTime = performance.now();
      try {
        const text = await generateModelResponse(model, prompt);
        const endTime = performance.now();
        
        setResponses(prev => ({
          ...prev,
          [model.id]: {
            modelId: model.id,
            text,
            status: 'success',
            executionTime: endTime - startTime
          }
        }));
      } catch (error) {
        setResponses(prev => ({
          ...prev,
          [model.id]: {
            modelId: model.id,
            text: 'Failed to generate response',
            status: 'error'
          }
        }));
      }
    });

    await Promise.all(promises);
    setIsGenerating(false);
  }, []);

  // Responsive grid class calculation
  const getGridClass = () => {
    switch (gridCols) {
        case 1: return 'grid-cols-1';
        case 2: return 'grid-cols-1 md:grid-cols-2';
        case 3: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
        case 4: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4';
        default: return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4';
    }
  };

  return (
    // Added pt-safe to handle iPhone Notch/Status bar area
    <div className="min-h-screen flex flex-col bg-slate-900 text-slate-100 pt-safe">
      {/* Navbar */}
      <header className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-sm border-b border-slate-800 p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-900/50">
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                    </svg>
                </div>
                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400">
                    OmniModel Arena
                </h1>
            </div>
            <div className="text-xs font-mono text-slate-500 border border-slate-800 px-2 py-1 rounded">
                v1.0.0
            </div>
        </div>
      </header>

      {/* Main Grid Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 overflow-hidden flex flex-col">
        <div className={`grid gap-4 w-full h-full ${getGridClass()}`}>
          {AVAILABLE_MODELS.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              response={responses[model.id]}
            />
          ))}
        </div>
      </main>

      {/* Footer / Controls */}
      <ControlPanel 
        onSearch={handleSearch} 
        isGenerating={isGenerating} 
        gridCols={gridCols}
        setGridCols={setGridCols}
      />
    </div>
  );
}