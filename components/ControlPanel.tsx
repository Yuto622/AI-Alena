import React, { useState, KeyboardEvent } from 'react';

interface ControlPanelProps {
  onSearch: (prompt: string) => void;
  isGenerating: boolean;
  gridCols: number;
  setGridCols: (cols: number) => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({ 
  onSearch, 
  isGenerating, 
  gridCols, 
  setGridCols 
}) => {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = () => {
    if (!prompt.trim() || isGenerating) return;
    onSearch(prompt);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        handleSubmit();
    }
  };

  return (
    // Added pb-safe to handle iPhone Home Indicator
    <div className="sticky bottom-0 z-20 w-full bg-slate-900/95 backdrop-blur-md border-t border-slate-700 p-4 pb-6 pb-safe shadow-2xl">
      <div className="max-w-7xl mx-auto flex flex-col gap-4">
        
        {/* Input Row */}
        <div className="relative group">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="ここに質問を入力してください（例：量子コンピュータについて五・七・五で説明して）"
            className="w-full bg-slate-800 text-white rounded-xl border border-slate-600 p-4 pr-32 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-xl resize-none h-24 custom-scrollbar transition-all"
            disabled={isGenerating}
          />
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <span className="text-[10px] text-slate-500 hidden sm:inline">Cmd + Enter</span>
            <button
              onClick={handleSubmit}
              disabled={!prompt.trim() || isGenerating}
              className={`px-4 py-2 rounded-lg font-bold text-sm transition-all flex items-center gap-2
                ${!prompt.trim() || isGenerating 
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 active:scale-95'}`}
            >
              {isGenerating ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  停止
                </>
              ) : (
                <>
                  送信
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <div className="flex items-center gap-4">
                <span className="hidden sm:inline">レイアウト切替:</span>
                <div className="flex bg-slate-800 rounded-lg p-1 border border-slate-700">
                    {[1, 2, 4].map((cols) => (
                        <button
                            key={cols}
                            onClick={() => setGridCols(cols)}
                            className={`px-3 py-1 rounded-md transition-colors ${
                                gridCols === cols ? 'bg-slate-600 text-white font-medium' : 'hover:bg-slate-700'
                            }`}
                        >
                            {cols === 1 ? '1列' : cols === 2 ? '2列' : '4列'}
                        </button>
                    ))}
                </div>
            </div>
            
            <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                <span>全システム正常</span>
            </div>
        </div>
      </div>
    </div>
  );
};