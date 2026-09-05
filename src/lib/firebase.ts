import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  deleteDoc, 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  getDocFromServer 
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId || undefined);

// Validate connection
export async function validateFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, '_health', 'connection_test'));
    return true;
  } catch (error: any) {
    if (error?.message?.includes('the client is offline')) {
      console.warn("Firestore connection: client is offline or database initializing.");
      return false;
    }
    // Any other response (like permission or not-found) indicates online connectivity
    return true;
  }
}

export interface UserMemoryProfile {
  userId: string;
  summary: string;
  facts: string[];
  sessionCount: number;
  lastSessionEnd: string;
  updatedAt: string;
}

export interface MemoryItem {
  id: string;
  userId: string;
  category: 'preference' | 'creative_style' | 'fact' | 'custom_instruction';
  text: string;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_USER_ID = 'user_default';

/**
 * Fetch consolidated user memory profile
 */
export async function fetchUserMemoryProfile(userId: string = DEFAULT_USER_ID): Promise<UserMemoryProfile | null> {
  try {
    const docRef = doc(db, 'user_memories', userId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as UserMemoryProfile;
    }
    return null;
  } catch (err) {
    console.error("Failed to load user memory profile:", err);
    return null;
  }
}

/**
 * Fetch granular memory items for the user
 */
export async function fetchMemoryItems(userId: string = DEFAULT_USER_ID): Promise<MemoryItem[]> {
  try {
    const itemsRef = collection(db, 'user_memories', userId, 'items');
    const q = query(itemsRef, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const items: MemoryItem[] = [];
    snap.forEach(d => {
      items.push({ id: d.id, ...d.data() } as MemoryItem);
    });
    return items;
  } catch (err) {
    console.error("Failed to load memory items:", err);
    return [];
  }
}

/**
 * Save / Update consolidated profile
 */
export async function saveUserMemoryProfile(
  profile: Partial<UserMemoryProfile>, 
  userId: string = DEFAULT_USER_ID
): Promise<void> {
  try {
    const docRef = doc(db, 'user_memories', userId);
    const existing = await fetchUserMemoryProfile(userId);
    const updated: UserMemoryProfile = {
      userId,
      summary: profile.summary ?? existing?.summary ?? 'New companion profile.',
      facts: profile.facts ?? existing?.facts ?? [],
      sessionCount: (existing?.sessionCount ?? 0) + 1,
      lastSessionEnd: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await setDoc(docRef, updated, { merge: true });
  } catch (err) {
    console.error("Failed to save user memory profile:", err);
  }
}

/**
 * Add or update an individual memory item
 */
export async function upsertMemoryItem(
  item: { id?: string; category: MemoryItem['category']; text: string },
  userId: string = DEFAULT_USER_ID
): Promise<string> {
  try {
    const id = item.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const docRef = doc(db, 'user_memories', userId, 'items', id);
    const now = new Date().toISOString();
    const data: MemoryItem = {
      id,
      userId,
      category: item.category,
      text: item.text.trim(),
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(docRef, data, { merge: true });
    return id;
  } catch (err) {
    console.error("Failed to upsert memory item:", err);
    throw err;
  }
}

/**
 * Delete a specific memory item
 */
export async function deleteMemoryItem(
  itemId: string, 
  userId: string = DEFAULT_USER_ID
): Promise<void> {
  try {
    const docRef = doc(db, 'user_memories', userId, 'items', itemId);
    await deleteDoc(docRef);
  } catch (err) {
    console.error("Failed to delete memory item:", err);
    throw err;
  }
}

/**
 * Completely wipe all memories for the user
 */
export async function wipeAllUserMemories(userId: string = DEFAULT_USER_ID): Promise<void> {
  try {
    // Delete all items in subcollection
    const items = await fetchMemoryItems(userId);
    for (const item of items) {
      await deleteDoc(doc(db, 'user_memories', userId, 'items', item.id));
    }
    // Delete parent profile doc
    await deleteDoc(doc(db, 'user_memories', userId));
  } catch (err) {
    console.error("Failed to wipe user memories:", err);
    throw err;
  }
}
