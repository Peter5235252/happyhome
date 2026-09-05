import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Brain, 
  Trash2, 
  Edit2, 
  Check, 
  X, 
  Plus, 
  Sparkles, 
  ShieldAlert, 
  RefreshCw, 
  Tag
} from 'lucide-react';
import { 
  fetchUserMemoryProfile, 
  fetchMemoryItems, 
  upsertMemoryItem, 
  deleteMemoryItem, 
  wipeAllUserMemories, 
  saveUserMemoryProfile,
  UserMemoryProfile, 
  MemoryItem 
} from '../lib/firebase';
import { sound } from '../audio/soundEffects';

interface MemoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMemoryChanged?: () => void;
}

export const MemoryManagerModal: React.FC<MemoryManagerModalProps> = ({
  isOpen,
  onClose,
  onMemoryChanged
}) => {
  const [profile, setProfile] = useState<UserMemoryProfile | null>(null);
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWiping, setIsWiping] = useState(false);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryItem['category']>('preference');
  const [isAdding, setIsAdding] = useState(false);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [summaryText, setSummaryText] = useState('');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const p = await fetchUserMemoryProfile();
      const it = await fetchMemoryItems();
      setProfile(p);
      setItems(it);
      setSummaryText(p?.summary || '');
    } catch (err) {
      console.error("Failed to load memory data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
      setShowWipeConfirm(false);
      setEditingId(null);
      setIsAdding(false);
    }
  }, [isOpen]);

  const handleSaveSummary = async () => {
    if (!summaryText.trim()) return;
    sound.playTap();
    try {
      await saveUserMemoryProfile({ summary: summaryText.trim() });
      setIsEditingSummary(false);
      await loadData();
      onMemoryChanged?.();
    } catch (err) {
      console.error("Failed to update summary:", err);
    }
  };

  const handleSaveEdit = async (itemId: string, category: MemoryItem['category']) => {
    if (!editText.trim()) return;
    sound.playTap();
    try {
      await upsertMemoryItem({ id: itemId, category, text: editText.trim() });
      setEditingId(null);
      await loadData();
      onMemoryChanged?.();
    } catch (err) {
      console.error("Failed to update item:", err);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    sound.playTap();
    try {
      await deleteMemoryItem(itemId);
      setItems(prev => prev.filter(i => i.id !== itemId));
      onMemoryChanged?.();
    } catch (err) {
      console.error("Failed to delete item:", err);
    }
  };

  const handleAddNew = async () => {
    if (!newText.trim()) return;
    sound.playTap();
    try {
      await upsertMemoryItem({ category: newCategory, text: newText.trim() });
      setNewText('');
      setIsAdding(false);
      await loadData();
      onMemoryChanged?.();
    } catch (err) {
      console.error("Failed to add memory item:", err);
    }
  };

  const handleWipe = async () => {
    sound.playTap();
    setIsWiping(true);
    try {
      await wipeAllUserMemories();
      setProfile(null);
      setItems([]);
      setShowWipeConfirm(false);
      onMemoryChanged?.();
    } catch (err) {
      console.error("Failed to wipe memories:", err);
    } finally {
      setIsWiping(false);
    }
  };

  const categoryLabels: Record<MemoryItem['category'], { label: string; color: string }> = {
    preference: { label: 'Preference', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
    creative_style: { label: 'Creative Style', color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
    fact: { label: 'Fact', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
    custom_instruction: { label: 'Custom Rule', color: 'bg-purple-500/15 text-purple-300 border-purple-500/30' },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          {/* Frosted Glass Backdrop — filter ready instantly on first frame, opacity fades smoothly with container */}
          <motion.div 
            id="memory-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 frosted-glass-backdrop frosted-instant"
            onClick={() => {
              sound.playTap();
              onClose();
            }}
          />

          {/* Frosted Glass Modal Container — restored slide/fade, glass fades smoothly in sync (no abrupt pop) */}
          <motion.div
            id="memory-modal-container"
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl frosted-glass-panel frosted-instant text-neutral-100 shadow-2xl overflow-hidden z-10 transform-gpu"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Brain className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white tracking-tight flex items-center gap-2">
                    AI Memory & Profile
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-medium">
                      Cloud Synced
                    </span>
                  </h2>
                  <p className="text-xs text-neutral-400">
                    Transparent cross-session memory summarized across your 3D creative sessions
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    sound.playTap();
                    loadData();
                  }}
                  disabled={isLoading}
                  title="Refresh Cloud Memory"
                  className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => {
                    sound.playTap();
                    onClose();
                  }}
                  className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {isLoading ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-neutral-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-amber-400" />
                  <span className="text-sm">Loading cloud memory profile...</span>
                </div>
              ) : (
                <>
                  {/* Consolidated Narrative Summary */}
                  <div className="rounded-xl p-4.5 bg-neutral-900/40 border border-white/10 backdrop-blur-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-medium text-amber-400 uppercase tracking-wider">
                        <Sparkles className="w-3.5 h-3.5" />
                        Consolidated Memory Summary
                      </div>
                      {!isEditingSummary && (
                        <button
                          onClick={() => {
                            sound.playTap();
                            setSummaryText(profile?.summary || '');
                            setIsEditingSummary(true);
                          }}
                          className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/10 transition-colors"
                        >
                          <Edit2 className="w-3 h-3" />
                          Edit
                        </button>
                      )}
                    </div>

                    {isEditingSummary ? (
                      <div className="space-y-2.5">
                        <textarea
                          value={summaryText}
                          onChange={(e) => setSummaryText(e.target.value)}
                          rows={3}
                          className="w-full text-sm rounded-lg bg-neutral-950/60 border border-white/15 p-3 text-neutral-200 backdrop-blur-xl focus:outline-none focus:border-amber-400/60 resize-none"
                          placeholder="Enter consolidated summary of your creative tastes..."
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              sound.playTap();
                              setIsEditingSummary(false);
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveSummary}
                            className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-400 text-black flex items-center gap-1.5 transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                            Save Summary
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-neutral-200 leading-relaxed font-light">
                        {profile?.summary || (
                          <span className="text-neutral-500 italic">
                            No memory summary recorded yet. Complete a voice session to have the AI consolidate your creative preferences!
                          </span>
                        )}
                      </p>
                    )}

                    {profile?.sessionCount ? (
                      <div className="flex items-center gap-4 pt-2 text-[11px] text-neutral-400 border-t border-white/5">
                        <span>Sessions Recorded: <strong className="text-neutral-200">{profile.sessionCount}</strong></span>
                        {profile.lastSessionEnd && (
                          <span>Last Synced: <strong className="text-neutral-200">{new Date(profile.lastSessionEnd).toLocaleDateString()} {new Date(profile.lastSessionEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></span>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {/* Granular Remembered Items */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider flex items-center gap-2">
                        <Tag className="w-3.5 h-3.5 text-neutral-400" />
                        Remembered Facts & Preferences ({items.length})
                      </h3>
                      {!isAdding && (
                        <button
                          onClick={() => {
                            sound.playTap();
                            setIsAdding(true);
                          }}
                          className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Memory
                        </button>
                      )}
                    </div>

                    {/* Add New Memory Form */}
                    {isAdding && (
                      <motion.div 
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl p-3.5 bg-neutral-900/40 border border-amber-500/30 backdrop-blur-xl space-y-3"
                      >
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-neutral-400">Category:</label>
                          <select
                            value={newCategory}
                            onChange={(e) => setNewCategory(e.target.value as any)}
                            className="text-xs rounded-lg bg-neutral-950/60 border border-white/10 px-2.5 py-1 text-neutral-200 backdrop-blur-md focus:outline-none"
                          >
                            <option value="preference">Preference</option>
                            <option value="creative_style">Creative Style</option>
                            <option value="fact">Fact</option>
                            <option value="custom_instruction">Custom Instruction</option>
                          </select>
                        </div>
                        <input
                          type="text"
                          value={newText}
                          onChange={(e) => setNewText(e.target.value)}
                          placeholder="e.g. Likes golden hour lighting with volumetric godrays..."
                          className="w-full text-sm rounded-lg bg-neutral-950/60 border border-white/10 px-3 py-2 text-white backdrop-blur-md focus:outline-none focus:border-amber-400/60"
                        />
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              sound.playTap();
                              setIsAdding(false);
                            }}
                            className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleAddNew}
                            disabled={!newText.trim()}
                            className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black flex items-center gap-1.5 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Add Memory
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {/* List of Memory Items */}
                    {items.length === 0 && !isAdding ? (
                      <div className="py-8 text-center text-xs text-neutral-500 bg-neutral-900/20 rounded-xl border border-white/5 p-6 backdrop-blur-md">
                        No specific memory items recorded yet. They will appear here automatically as you converse with the AI!
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {items.map((item) => {
                          const isEditing = editingId === item.id;
                          const catInfo = categoryLabels[item.category] || categoryLabels.preference;

                          return (
                            <div
                              key={item.id}
                              className="group flex items-center justify-between gap-3 p-3 rounded-xl bg-neutral-900/30 hover:bg-neutral-900/50 border border-white/5 backdrop-blur-md transition-all"
                            >
                              {isEditing ? (
                                <div className="flex-1 flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    className="flex-1 text-xs rounded-lg bg-neutral-950/70 border border-amber-400/50 px-2.5 py-1.5 text-white backdrop-blur-md focus:outline-none"
                                    autoFocus
                                  />
                                  <button
                                    onClick={() => handleSaveEdit(item.id, item.category)}
                                    className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      sound.playTap();
                                      setEditingId(null);
                                    }}
                                    className="p-1.5 rounded-lg text-neutral-400 hover:bg-white/10 transition-colors"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border shrink-0 ${catInfo.color}`}>
                                      {catInfo.label}
                                    </span>
                                    <p className="text-xs text-neutral-200 font-light truncate">
                                      {item.text}
                                    </p>
                                  </div>

                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => {
                                        sound.playTap();
                                        setEditingId(item.id);
                                        setEditText(item.text);
                                      }}
                                      title="Edit Memory"
                                      className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteItem(item.id)}
                                      title="Delete Memory"
                                      className="p-1.5 rounded-lg text-neutral-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer / Wipe Option */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-white/[0.01]">
              {showWipeConfirm ? (
                <div className="flex items-center justify-between w-full p-2.5 rounded-xl bg-red-950/40 border border-red-500/30 backdrop-blur-xl text-red-200">
                  <div className="flex items-center gap-2 text-xs">
                    <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
                    <span>Permanently wipe all cross-session memory from cloud?</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        sound.playTap();
                        setShowWipeConfirm(false);
                      }}
                      className="px-2.5 py-1 text-xs text-neutral-400 hover:text-white rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleWipe}
                      disabled={isWiping}
                      className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
                    >
                      {isWiping ? 'Wiping...' : 'Confirm Wipe'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => {
                      sound.playTap();
                      setShowWipeConfirm(true);
                    }}
                    className="text-xs text-neutral-400 hover:text-red-400 flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Wipe AI Memory
                  </button>

                  <button
                    onClick={() => {
                      sound.playTap();
                      onClose();
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-medium bg-neutral-900/50 hover:bg-neutral-800/60 border border-white/10 text-white backdrop-blur-xl transition-colors"
                  >
                    Done
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
