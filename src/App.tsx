/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { Copy, Download, Trash2, Info, ArrowRightCircle, BookOpen, X, ChevronRight, ChevronLeft, LogOut, ShieldCheck, Mail } from 'lucide-react';
import { marked } from 'marked';
import katex from 'katex';
import { onAuthStateChanged, signInWithPopup, User, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db } from './lib/firebase';

export default function App() {
  const [inputText, setInputText] = useState('');
  const [inputMode, setInputMode] = useState<'markdown' | 'raw'>('raw');
  const [previewHtml, setPreviewHtml] = useState('');
  const [wordHtml, setWordHtml] = useState('');
  const [showAlert, setShowAlert] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [guideStep, setGuideStep] = useState(1);
  const totalGuideSteps = 4;

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [unlockEmailInput, setUnlockEmailInput] = useState('');
  const [adminMsg, setAdminMsg] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Check if admin
        try {
          const adminDoc = await getDoc(doc(db, 'admins', currentUser.uid));
          if (adminDoc.exists() || currentUser.email === 'huyspdn@gmail.com') {
            setIsAdmin(true);
          } else {
            setIsAdmin(false);
          }
        } catch(e) {
          if (currentUser.email === 'huyspdn@gmail.com') setIsAdmin(true);
        }

        // Check if unlocked
        try {
          if (currentUser.email) {
            const unlockedDoc = await getDoc(doc(db, 'unlocked_users', currentUser.email));
            if (unlockedDoc.exists()) {
              setIsUnlocked(true);
            } else {
              setIsUnlocked(false);
            }
          }
        } catch(e) {
             setIsUnlocked(false);
        }
      } else {
        setIsAdmin(false);
        setIsUnlocked(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setShowLimitModal(false);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleUnlockUser = async () => {
    if (!unlockEmailInput || !user) return;
    try {
      await setDoc(doc(db, 'unlocked_users', unlockEmailInput.trim()), {
        unlocked: true,
        unlockedAt: serverTimestamp(),
        unlockedBy: user.uid
      });
      setAdminMsg(`Đã mở khóa thành công cho: ${unlockEmailInput}`);
      setUnlockEmailInput('');
      setTimeout(() => setAdminMsg(''), 3000);
    } catch (error: any) {
      console.error("Unlock error", error);
      setAdminMsg(`Lỗi: ${error.message}`);
    }
  };

  // Process logic
  const handleConvert = () => {
    if (!inputText.trim()) {
      setPreviewHtml('');
      setWordHtml('');
      setIsSynced(true);
      return;
    }

    // Rate Limiting Logic via LocalStorage
    if (!isUnlocked) {
      const today = new Date().toISOString().split('T')[0];
      const usageKey = `formula_flow_usage_${today}`;
      const usageCount = parseInt(localStorage.getItem(usageKey) || '0', 10);

      if (usageCount >= 5) {
        setShowLimitModal(true);
        return;
      }

      // Increment usage
      localStorage.setItem(usageKey, (usageCount + 1).toString());
    }

    let baseText = inputText;

    if (inputMode === 'raw') {
      // In raw mode, if a line doesn't start with % and isn't empty, wrap it in $$ $$ for math extraction.
      baseText = inputText.split('\n').map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('%')) {
          // It's a text comment, strip the % so it shows as text
          return trimmed.substring(1).trim();
        } else if (trimmed !== '') {
          // It's a math formula
          return `$$${trimmed}$$`;
        }
        return '';
      }).join('\n\n');
    }

    let text = baseText;

    // A regex to match block and inline math formulas
    // It captures:
    // 1: $$...$$
    // 2: \[...\]
    // 3: $...$
    // 4: \(...\)
    // 5: \begin{...}...\end{...}
    const mathRegex = /(\$\$[\s\S]*?\$\$)|(\\\[[\s\S]*?\\\])|(\$[^$\n]*?\$)|(\\\([\s\S]*?\\\))|(\\begin\{[a-zA-Z*]+\}[\s\S]*?\\end\{[a-zA-Z*]+\})/g;
    
    const tokens: string[] = [];
    let index = 0;

    // Replace math with placeholders so markdown parser doesn't mangle it
    const textWithTokens = text.replace(mathRegex, (match) => {
      tokens.push(match);
      return `%%%MATH_${index++}%%%`;
    });

    const parsedBaseHtml = marked.parse(textWithTokens) as string;

    const extractLatex = (match: string) => {
      let latex = match;
      let displayMode = false;
      
      if (latex.startsWith('$$') && latex.endsWith('$$')) {
        latex = latex.substring(2, latex.length - 2);
        displayMode = true;
      } else if (latex.startsWith('\\[') && latex.endsWith('\\]')) {
        latex = latex.substring(2, latex.length - 2);
        displayMode = true;
      } else if (latex.startsWith('\\(') && latex.endsWith('\\)')) {
        latex = latex.substring(2, latex.length - 2);
      } else if (latex.startsWith('$') && latex.endsWith('$')) {
        latex = latex.substring(1, latex.length - 1);
      } else if (latex.startsWith('\\begin{')) {
        displayMode = true;
      } // In case of bare LaTeX, we might leave it as is if it doesn't match above, but the regex enforces this.

      // Trim whitespace for safety
      return { latex: latex.trim(), displayMode };
    };

    // Replace tokens with KaTeX rendered HTML for screen preview
    const newPreviewHtml = parsedBaseHtml.replace(/%%%MATH_(\d+)%%%/g, (wholeMatch, iStr) => {
      const i = parseInt(iStr, 10);
      const match = tokens[i];
      try {
        const { latex, displayMode } = extractLatex(match);
        return katex.renderToString(latex, { displayMode, throwOnError: false, output: 'htmlAndMathml' });
      } catch (e) {
        return match;
      }
    });

    // Replace tokens with pure MathML for Word clipboard
    const newWordHtml = parsedBaseHtml.replace(/%%%MATH_(\d+)%%%/g, (wholeMatch, iStr) => {
      const i = parseInt(iStr, 10);
      const match = tokens[i];
      try {
        const { latex, displayMode } = extractLatex(match);
        return katex.renderToString(latex, { displayMode, throwOnError: false, output: 'mathml' });
      } catch (e) {
        return match;
      }
    });

    setPreviewHtml(newPreviewHtml);
    setWordHtml(newWordHtml);
    setIsSynced(true);
  };

  // Handle Copy to Clipboard
  const handleCopyToWord = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.write) {
        throw new Error('Clipboard API not supported');
      }

      // Word requires a valid HTML document wrapper for best results
      const fullHtml = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
        <head><meta charset="utf-8"></head>
        <body>${wordHtml}</body>
        </html>
      `;

      const blobHtml = new Blob([fullHtml], { type: 'text/html' });
      const blobText = new Blob([inputText], { type: 'text/plain' });
      
      const clipboardItem = new window.ClipboardItem({
        'text/html': blobHtml,
        'text/plain': blobText,
      });

      await navigator.clipboard.write([clipboardItem]);
      triggerAlert();
    } catch (err) {
      console.error('Failed to copy', err);
      // Fallback for older browsers
      const el = document.createElement('div');
      el.innerHTML = wordHtml;
      document.body.appendChild(el);
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('copy');
      document.body.removeChild(el);
      triggerAlert();
    }
  };

  const handleExportToFile = () => {
    const fullHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"><title>Exported from ChatGPT</title></head>
      <body>${wordHtml}</body>
      </html>
    `;
    const blob = new Blob([fullHtml], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ChatGPT_Math.doc';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const triggerAlert = () => {
    setShowAlert(true);
    setTimeout(() => setShowAlert(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0d1236] to-[#03040a] text-slate-900 flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <nav className="h-20 border-b border-white/10 bg-[#0d1236]/80 backdrop-blur-md flex items-center justify-between px-6 md:px-10 shrink-0 sticky top-0 z-10 shadow-lg">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 bg-gradient-to-br from-indigo-500 to-violet-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30 border border-white/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-sigma text-white"><path d="M18 7V4H6l6 8-6 8h12v-3"/></svg>
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-extrabold tracking-tight text-white leading-tight flex items-center gap-2">
              Formula Flow
              <span className="text-sm font-bold text-indigo-100 bg-white/10 px-2 py-0.5 rounded border border-white/20 hidden sm:inline-block">Chuyển Đổi Công Thức</span>
            </h1>
            <p className="text-xs font-medium text-slate-400 tracking-wide mt-0.5">By: Lê Thanh Huy - TH1P (0983027581)</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 md:gap-6">
          <button 
            onClick={() => { setIsGuideOpen(true); setGuideStep(1); }}
            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-indigo-200 bg-indigo-500/20 border border-indigo-500/30 rounded-lg hover:bg-indigo-500/30 transition-colors shadow-sm"
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline">Hướng dẫn</span>
          </button>
          
          <button 
            onClick={() => { setInputText(''); setIsSynced(false); setPreviewHtml(''); setWordHtml(''); }}
            className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors border border-transparent hover:border-white/20"
          >
            Clear
          </button>
          <button 
            onClick={handleExportToFile}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-white/10 border border-white/20 rounded-lg hover:bg-white/20 shadow-sm transition-all"
            title="Download as a .doc file (can be opened in Word directly)"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export .doc</span>
          </button>
          <button 
            onClick={handleCopyToWord}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white px-5 py-2.5 rounded-lg font-semibold shadow-md transition-all hover:shadow-lg border border-indigo-400/50"
          >
            <Copy className="w-4 h-4" />
            <span className="hidden sm:inline">Copy for Word</span>
          </button>

          {/* User Auth Section */}
          {user ? (
            <div className="flex items-center gap-2 border-l border-white/10 pl-4 ml-2">
              <div className="flex flex-col items-end hidden lg:flex">
                <span className="text-[13px] font-bold text-white max-w-[120px] truncate" title={user.email || ""}>{user.displayName || user.email}</span>
                <span className={`text-[10px] uppercase font-bold tracking-wider ${isAdmin ? 'text-amber-300' : (isUnlocked ? 'text-[#34d399]' : 'text-slate-400')}`}>
                  {isAdmin ? 'Admin' : (isUnlocked ? 'Đã kích hoạt' : 'Miễn phí')}
                </span>
              </div>
              <img src={user.photoURL || `https://ui-avatars.com/api/?name=${user.email}`} alt="avatar" className="w-9 h-9 rounded-full border-2 border-white/10" />
              {isAdmin && (
                <button 
                  onClick={() => setAdminPanelOpen(true)}
                  className="p-2 text-amber-300 hover:text-amber-200 bg-amber-500/10 rounded-lg hover:bg-amber-500/20 transition-colors border border-amber-500/20"
                  title="Admin Panel"
                >
                  <ShieldCheck className="w-5 h-5" />
                </button>
              )}
              <button 
                onClick={() => signOut(auth)}
                className="p-2 text-slate-400 hover:text-white bg-white/5 rounded-lg hover:bg-white/10 transition-colors"
                title="Đăng xuất"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 border-l border-white/10 pl-4 ml-2">
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors shadow-sm whitespace-nowrap"
              >
                Đăng nhập
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Main Workspace */}
      <main className="flex-1 p-4 md:p-8 flex flex-col md:flex-row gap-4 h-[calc(100vh-80px)] overflow-hidden items-stretch">
        
        {/* Left Pane: Input */}
        <div className="flex-1 flex flex-col gap-3 overflow-hidden bg-white/10 backdrop-blur-md p-5 rounded-3xl shadow-2xl border border-white/20">
          <div className="flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <label className="text-xs font-bold uppercase tracking-widest text-[#a5b4fc]">Source Format</label>
              <select 
                className="text-xs font-medium text-slate-800 bg-white/90 border border-white/20 rounded px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                value={inputMode}
                onChange={(e) => { setInputMode(e.target.value as 'markdown' | 'raw'); setIsSynced(false); }}
              >
                <option value="raw">Raw LaTeX Lines</option>
                <option value="markdown">Markdown + Match ($...$)</option>
              </select>
            </div>
            
            <div className="group relative cursor-help">
              <Info className="w-5 h-5 text-indigo-300 hover:text-white transition-colors" />
              <div className="invisible group-hover:visible absolute right-0 top-8 w-72 p-4 bg-slate-800/95 backdrop-blur text-xs text-white rounded-xl shadow-2xl border border-white/10 z-20">
                <p className="font-bold mb-1 text-indigo-300">Markdown + Math</p>
                <p className="mb-3 text-slate-300">For text containing math blocks like $E=mc^2$ or $$x=1$$ combined with normal text.</p>
                <p className="font-bold mb-1 text-indigo-300">Raw LaTeX Lines (Mặc định)</p>
                <p className="text-slate-300">For raw equations without dollar signs. Lines starting with % are treated as normal text.</p>
              </div>
            </div>
          </div>
          <div className="flex-1 bg-white/90 backdrop-blur-sm border-2 border-white/20 rounded-2xl shadow-inner p-5 font-mono text-sm leading-relaxed text-slate-700 overflow-hidden relative group">
             <textarea
              className="w-full h-full resize-none focus:outline-none bg-transparent text-slate-800 placeholder-slate-400"
              placeholder={inputMode === 'markdown' ? "Paste your text with formulas from ChatGPT...\n\nSupports:\n• Inline formatting: $\\sum_{i=1}^n x_i$  or  \\( a^2+b^2 \\)\n• Block formatting: $$ \\int e^x dx $$  or  \\[ x = \\frac{-b}{2a} \\]" : "Paste raw LaTeX formulas line by line...\n\nExample:\n% 1. Định lý Pythagore\na^2 + b^2 = c^2\n\n% 2. Phương trình bậc hai\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"}
              value={inputText}
              onChange={(e) => { setInputText(e.target.value); setIsSynced(false); }}
              spellCheck={false}
            />
          </div>
        </div>

        {/* Center Actions */}
        <div className="flex md:flex-col items-center justify-center shrink-0 py-2 relative z-10">
          <button 
            onClick={handleConvert}
            className="flex items-center justify-center gap-2 px-6 py-3 md:px-4 md:py-8 md:flex-col text-sm font-bold text-white bg-gradient-to-br from-indigo-500 to-violet-600 border border-white/20 rounded-2xl shadow-[0_0_20px_rgba(99,102,241,0.4)] hover:shadow-[0_0_30px_rgba(99,102,241,0.6)] hover:-translate-y-1 transition-all active:translate-y-0 overflow-hidden group"
          >
            <div className="absolute inset-0 bg-white/20 transform origin-bottom scale-y-0 group-hover:scale-y-100 transition-transform"></div>
            <ArrowRightCircle className="w-6 h-6 md:w-8 md:h-8 relative z-10 rotate-90 md:rotate-0" />
            <span className="relative z-10 tracking-wide uppercase whitespace-nowrap">Chuyển đổi</span>
          </button>
        </div>

        {/* Right Pane: Preview */}
        <div className="flex-1 flex flex-col gap-3 overflow-hidden bg-white/10 backdrop-blur-md p-5 rounded-3xl shadow-2xl border border-white/20">
          <div className="flex items-center justify-between shrink-0">
            <label className="text-xs font-bold uppercase tracking-widest text-[#a5b4fc]">Preview: Microsoft Word Format</label>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 ${isSynced ? 'bg-[#34d399] animate-pulse shadow-[0_0_10px_#34d399]' : (inputText ? 'bg-[#fbbf24] shadow-[0_0_8px_#fbbf24]' : 'bg-slate-400')} rounded-full`}></span>
              <span className="text-xs font-medium text-slate-300">{isSynced ? 'Synced & Ready' : (inputText ? 'Needs Conversion' : 'Awaiting Input')}</span>
            </div>
          </div>
          <div className="flex-1 bg-white border-2 border-indigo-200 rounded-2xl shadow-xl p-6 md:p-8 flex flex-col gap-10 overflow-y-auto relative">
            {/* Word Document Simulation Header */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-indigo-500 to-violet-500"></div>
            
            {inputText ? (
              <div 
                className="prose prose-slate max-w-none text-slate-800"
                dangerouslySetInnerHTML={{ __html: previewHtml }} 
              />
            ) : (
              <div className="h-full flex items-center justify-center flex-col text-slate-300 space-y-4">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center border-2 border-dashed border-slate-200">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M10 9h4"/></svg>
                </div>
                <p className="text-sm font-medium tracking-wide">Preview will appear here</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Toast Alert */}
      {showAlert && (
        <div className="fixed bottom-6 right-6 bg-slate-800 text-white px-4 py-3 rounded-lg shadow-xl flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 z-50">
          <div className="bg-green-500 rounded-full p-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <p className="text-sm font-medium">Copied to clipboard! Ready for Word.</p>
        </div>
      )}

      {/* Guide Modal */}
      {isGuideOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-2 text-indigo-600">
                <BookOpen className="w-5 h-5" />
                <h3 className="font-bold text-lg text-slate-800">Hướng dẫn sử dụng</h3>
              </div>
              <button 
                onClick={() => setIsGuideOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                title="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex-1">
              <div className="flex items-center mb-6 gap-2">
                {[1, 2, 3, 4].map((step) => (
                  <div key={step} className="flex-1 flex flex-col gap-2">
                    <div className={`h-1.5 rounded-full w-full ${step <= guideStep ? 'bg-indigo-600' : 'bg-slate-100'}`} />
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${step <= guideStep ? 'text-indigo-600' : 'text-slate-400'}`}>Bước {step}</span>
                  </div>
                ))}
              </div>

              {guideStep === 1 && (
                <div className="space-y-4 animate-in slide-in-from-right-4">
                  <h4 className="text-xl font-bold text-slate-800">Yêu cầu AI xuất mã LaTeX</h4>
                  <p className="text-slate-600 text-sm leading-relaxed">
                    Đầu tiên, bạn ra lệnh cho ChatGPT hoặc Gemini: <strong className="text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded">Tạo công thức trên bằng mã dạng Latex cho tôi</strong>.
                  </p>
                  <div className="mt-4 flex flex-col gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <div className="flex gap-3 items-start">
                      <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-sm">You</div>
                      <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-slate-200 shadow-sm text-sm text-slate-700 w-fit">
                        Tạo công thức trên bằng mã dạng Latex cho tôi
                      </div>
                    </div>
                    <div className="flex gap-3 items-start mt-2">
                       <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white font-bold text-[10px] shrink-0 shadow-sm">AI</div>
                       <div className="bg-white p-3 rounded-2xl rounded-tr-none border border-slate-200 shadow-sm text-sm text-slate-700 w-full">
                         <p className="mb-2">Dạ, dưới đây là mã dạng LaTeX của công thức:</p>
                         <div className="bg-slate-800 p-2 rounded text-slate-200 font-mono text-xs border border-slate-700">
                           x = \frac{"{-b \\pm \\sqrt{b^2 - 4ac}}"}{"{2a}"}
                         </div>
                       </div>
                    </div>
                  </div>
                </div>
              )}

              {guideStep === 2 && (
                <div className="space-y-4 animate-in slide-in-from-right-4">
                  <h4 className="text-xl font-bold text-slate-800">Sao chép mã LaTeX từ AI</h4>
                  <p className="text-slate-600 text-sm leading-relaxed">
                    Bạn hãy copy phần mã LaTeX được bôi đen trong khung trả lời của ChatGPT (nhấn nút Copy hoặc dùng <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs font-mono">Ctrl + C</kbd>).
                  </p>
                  <div className="mt-4 p-4 bg-slate-800 rounded-xl border border-slate-700 shadow-inner relative overflow-hidden">
                    <div className="flex items-center gap-2 mb-3 opacity-50">
                      <div className="w-3 h-3 rounded-full bg-red-400"></div>
                      <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                      <div className="w-3 h-3 rounded-full bg-green-400"></div>
                    </div>
                    <div className="font-mono text-sm text-green-400 opacity-80 mb-2">% 1. Định lý Pythagore</div>
                    <div className="font-mono text-sm text-slate-200 mb-4 bg-slate-700/50 p-1 rounded">a^2 + b^2 = c^2</div>
                    <div className="font-mono text-sm text-green-400 opacity-80 mb-2">% 2. Phương trình</div>
                    <div className="font-mono text-sm text-slate-200 bg-slate-700/50 p-1 rounded">x = \frac{"{-b \\pm \\sqrt{b^2 - 4ac}}"}{"{2a}"}</div>
                    
                    <div className="absolute top-4 right-4 p-2 bg-indigo-500/20 rounded border border-indigo-400/30 flex items-center justify-center animate-pulse">
                      <Copy className="w-4 h-4 text-indigo-300" />
                    </div>
                  </div>
                </div>
              )}

              {guideStep === 3 && (
                <div className="space-y-4 animate-in slide-in-from-right-4">
                  <h4 className="text-xl font-bold text-slate-800">Dán, chọn chế độ và Chuyển đổi</h4>
                  <p className="text-slate-600 text-sm leading-relaxed">
                    Dán nội dung vào ô bên trái phần mềm. Đảm bảo chọn đúng chế độ <strong>(Raw LaTeX Lines)</strong> nếu mã không có thẻ đô-la. Sau đó nhấn nút <strong>Chuyển đổi</strong> ở giữa.
                  </p>
                  <div className="mt-4 flex gap-2">
                    <div className="flex-1 bg-slate-50 border-2 border-indigo-200 rounded-xl p-3 relative flex items-center justify-center h-40 shadow-sm border-dashed">
                       <span className="font-mono text-xs text-indigo-600 text-center font-semibold">Paste LaTeX here<br/><br/>(Ctrl + V)</span>
                    </div>
                    <div className="w-12 shrink-0 flex items-center justify-center">
                      <ArrowRightCircle className="w-8 h-8 text-indigo-500 animate-bounce" />
                    </div>
                    <div className="flex-1 bg-white border-2 border-slate-100 shadow-sm rounded-xl p-3 flex flex-col gap-2 h-40">
                      <div className="w-full h-2 bg-slate-200 rounded-full w-3/4"></div>
                      <div className="w-full h-10 bg-gradient-to-r from-indigo-50 to-violet-50 rounded mt-auto border border-indigo-100/50 mb-auto flex items-center justify-center">
                         <span className="text-sm font-serif italic text-indigo-900">a² + b² = c²</span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 rounded-full w-1/2"></div>
                    </div>
                  </div>
                </div>
              )}

              {guideStep === 4 && (
                <div className="space-y-4 animate-in slide-in-from-right-4">
                  <h4 className="text-xl font-bold text-slate-800">Bấm vào tải về hoặc Copy và Dán vào MS Word</h4>
                  <p className="text-slate-600 text-sm leading-relaxed">
                    Bạn có thể tải file trực tiếp bằng nút <strong>Export .doc</strong>, hoặc nhấn nút <strong>Copy for Word</strong> ở góc phải. Sau đó mở Word lên và nhấn <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs font-mono">Ctrl + V</kbd>. Công thức sẽ hiển thị chuẩn như thao tác gõ tay.
                  </p>
                  
                  <div className="flex gap-4 mb-4 bg-[#0d1236]/80 p-6 rounded-xl border border-white/10 items-center justify-center">
                    <div className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-white/10 border border-white/20 rounded-lg shadow-sm">
                      <Download className="w-4 h-4" />
                      Export .doc
                    </div>
                    <div className="flex items-center gap-2 bg-[#7c3aed] text-white px-5 py-2.5 rounded-lg font-semibold shadow-md">
                      <Copy className="w-4 h-4" />
                      Copy for Word
                    </div>
                  </div>

                  <div className="mt-2 bg-[#2B579A] rounded-xl overflow-hidden shadow-md">
                    {/* Word Header Mock */}
                    <div className="h-10 px-4 flex items-center justify-between border-b border-white/10">
                       <div className="flex items-center gap-3">
                         <div className="w-4 h-4 bg-white rounded-sm opacity-90 flex items-center justify-center text-[10px] font-bold text-[#2B579A]">W</div>
                         <div className="h-2 w-20 bg-white/30 rounded-full"></div>
                       </div>
                       <div className="flex gap-1.5">
                         <div className="w-3 h-3 rounded-full bg-white/20"></div>
                         <div className="w-3 h-3 rounded-full bg-white/20"></div>
                         <div className="w-3 h-3 rounded-full bg-white/20"></div>
                       </div>
                    </div>
                    <div className="bg-[#f3f2f1] h-10 flex items-center px-4 gap-3 border-b border-[#e1dfdd]">
                       <div className="h-5 w-12 bg-white rounded shadow-sm opacity-80 text-[9px] text-center leading-5 text-slate-600 font-bold">Home</div>
                       <div className="h-5 w-12 bg-transparent rounded opacity-50 text-[9px] text-center leading-5 text-slate-600">Insert</div>
                       <div className="h-5 w-12 bg-transparent rounded opacity-50 text-[9px] text-center leading-5 text-slate-600">Draw</div>
                    </div>
                    {/* Document Area */}
                    <div className="bg-slate-200 p-4">
                      <div className="bg-white mx-auto max-w-[200px] h-[120px] shadow-sm flex items-center justify-center flex-col gap-2 p-4 relative">
                        <div className="absolute top-2 left-2 px-2 py-0.5 bg-indigo-50 text-indigo-600 text-[9px] font-bold rounded border border-indigo-100">
                          Pasted Native Equation
                        </div>
                        <div className="text-xl font-serif mt-4 shadow-sm p-2 border border-slate-200 bg-white italic relative">
                          <div className="absolute -left-1 -top-1 w-2 h-2 border-l-2 border-t-2 border-indigo-400"></div>
                          <div className="absolute -right-1 -top-1 w-2 h-2 border-r-2 border-t-2 border-indigo-400"></div>
                          <div className="absolute -left-1 -bottom-1 w-2 h-2 border-l-2 border-b-2 border-indigo-400"></div>
                          <div className="absolute -right-1 -bottom-1 w-2 h-2 border-r-2 border-b-2 border-indigo-400"></div>
                          x = \frac{"{-b \\pm \\sqrt{b^2 - 4ac}}"}{"{2a}"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
              <button 
                onClick={() => setGuideStep(prev => Math.max(1, prev - 1))}
                disabled={guideStep === 1}
                className={`flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${guideStep === 1 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-600 hover:bg-slate-200'}`}
              >
                <ChevronLeft className="w-4 h-4" />
                Quay lại
              </button>

              <div className="flex gap-2">
                {guideStep < totalGuideSteps ? (
                  <button 
                    onClick={() => setGuideStep(prev => Math.min(totalGuideSteps, prev + 1))}
                    className="flex items-center gap-1 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
                  >
                    Tiếp tục
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button 
                    onClick={() => setIsGuideOpen(false)}
                    className="flex items-center gap-1 px-6 py-2 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow-sm transition-colors"
                  >
                    Đóng
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Limit Modal */}
      {showLimitModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col text-center">
            <div className="bg-gradient-to-br from-indigo-600 to-violet-600 p-8 flex justify-center items-center">
              <div className="w-20 h-20 bg-white/20 backdrop-blur rounded-full flex items-center justify-center border-4 border-white/30 shadow-inner">
                 <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              </div>
            </div>
            <div className="p-8 pt-6">
              <h3 className="text-2xl font-black text-slate-800 mb-2">Đã Đạt Giới Hạn</h3>
              <p className="text-slate-600 text-sm leading-relaxed mb-6 font-medium">
                Mỗi địa chỉ IP chỉ được phép chuyển đổi <strong className="text-indigo-600">5 lần/ngày</strong> để đảm bảo hiệu suất hệ thống.
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 relative overflow-hidden">
                 <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500"></div>
                 <p className="text-xs text-slate-500 mb-1 font-bold uppercase tracking-wider">Vui lòng liên hệ</p>
                 <p className="text-sm font-semibold text-slate-800">Thầy Lê Thanh Huy - TH1P</p>
                 <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-100 text-indigo-700 font-bold rounded-lg mt-2 font-mono">
                   <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                   0983 027 581
                 </span>
              </div>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => setShowLimitModal(false)}
                  className="w-full px-6 py-3 text-sm font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
                >
                  Đóng
                </button>
                {!user && (
                  <button 
                    onClick={handleLogin}
                    className="w-full px-6 py-3 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2"
                  >
                    <span>Đăng nhập để xác thực mở khóa</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Panel Modal */}
      {adminPanelOpen && isAdmin && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
            <div className="bg-slate-800 p-6 flex justify-between items-center">
              <div className="flex items-center gap-3 text-amber-400">
                <ShieldCheck className="w-6 h-6" />
                <h3 className="text-lg font-bold text-white">Quản Trị Admin</h3>
              </div>
              <button onClick={() => setAdminPanelOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-600 mb-4 font-medium">Nhập địa chỉ Email của người dùng đã liên hệ để mở khóa số lần sử dụng giới hạn.</p>
              
              <div className="space-y-4">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input 
                    type="email"
                    value={unlockEmailInput}
                    onChange={(e) => setUnlockEmailInput(e.target.value)}
                    placeholder="ví dụ: hocsinh@gmail.com"
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                </div>
                
                {adminMsg && (
                  <div className={`text-xs font-bold p-3 rounded-lg ${adminMsg.startsWith('Lỗi') ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-green-50 text-green-600 border border-green-100'}`}>
                    {adminMsg}
                  </div>
                )}
                
                <button 
                  onClick={handleUnlockUser}
                  disabled={!unlockEmailInput}
                  className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl shadow-lg shadow-amber-500/30 transition-all flex justify-center items-center gap-2"
                >
                  <ShieldCheck className="w-5 h-5" />
                  Mở Khóa Cho User
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
