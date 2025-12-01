import React, { useMemo } from 'react';
import { AIModel, ModelResponse } from '../types';

interface ModelCardProps {
  model: AIModel;
  response?: ModelResponse;
}

export const ModelCard: React.FC<ModelCardProps> = ({ model, response }) => {
  const status = response?.status || 'idle';
  const text = response?.text || '';
  const time = response?.executionTime;

  // Simple formatter to handle bold text and basic line breaks from Markdown
  const formattedText = useMemo(() => {
    if (!text) return null;
    return text.split('\n').map((line, i) => (
      <React.Fragment key={i}>
        {line.split(/(\*\*.*?\*\*)/).map((part, j) => 
          part.startsWith('**') && part.endsWith('**') ? (
            <strong key={j} className="text-blue-200">{part.slice(2, -2)}</strong>
          ) : (
            part
          )
        )}
        <br />
      </React.Fragment>
    ));
  }, [text]);

  return (
    <div className="flex flex-col h-full bg-slate-800 border border-slate-700 rounded-xl overflow-hidden shadow-lg transition-all hover:border-slate-600">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-slate-900/50 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${model.avatarColor}`}>
            {model.name.substring(0, 2).toUpperCase()}
          </div>
          <div className="flex flex-col">
            <h3 className="text-sm font-semibold text-white leading-tight">{model.name}</h3>
            <span className="text-[10px] text-slate-400">{model.provider}</span>
          </div>
        </div>
        {status === 'success' && time && (
          <span className="text-[10px] text-emerald-400 font-mono">
            {(time / 1000).toFixed(2)}s
          </span>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 p-4 overflow-y-auto custom-scrollbar min-h-[200px] text-sm leading-relaxed text-slate-300">
        {status === 'idle' && (
          <div className="h-full flex items-center justify-center text-slate-600 italic">
            Waiting for input...
          </div>
        )}
        
        {status === 'loading' && (
          <div className="h-full flex flex-col items-center justify-center gap-2">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-xs text-slate-500 animate-pulse">Thinking...</span>
          </div>
        )}

        {status === 'error' && (
          <div className="text-red-400 bg-red-900/20 p-3 rounded-lg border border-red-900/50">
            {text}
          </div>
        )}

        {status === 'success' && (
          <div className="whitespace-pre-wrap font-light">
             {formattedText}
             {model.id !== 'gemini' && (
                <div className="mt-4 pt-2 border-t border-slate-700 text-[10px] text-slate-500 italic">
                    * Simulated response via Gemini API
                </div>
             )}
          </div>
        )}
      </div>
    </div>
  );
};