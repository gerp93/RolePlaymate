/**
 * IPC for the library assistant, kept out of main.ts (already thousands of lines). Everything is
 * request/response except one push channel, `assistant:stream`, with the same shape as roleplay chat's:
 * `assistant:send` returns a streamId at once and a discriminated union of events follows.
 */
import { ipcMain } from 'electron';
import { assertMaxLength, FIELD_LIMITS } from '../shared/fieldLimits';
import {
  AssistantSettings,
  AssistantStreamEvent,
  MAX_STYLE_GUIDE_CHARS,
} from '../shared/types/assistant';
import { AssistantService } from './database/assistantService';
import { AssistantManager } from './chat/assistantSession';
import { LibraryServices } from './chat/assistantLibrary';
import { applyCreate, applyNewVersion } from './chat/assistantApply';
import type { CreatePayload, NewVersionPayload } from '../shared/types/assistant';

export interface AssistantIpcDeps {
  store: AssistantService;
  manager: AssistantManager;
  library: LibraryServices;
  /** Throws while a speed test owns the GPU, like roleplay chat's handlers do. */
  assertNoSpeedTest: () => void;
  getSettings: () => AssistantSettings;
  setSettings: (partial: Partial<AssistantSettings>) => AssistantSettings;
}

export function registerAssistantIpc(deps: AssistantIpcDeps): void {
  const { store, manager, library } = deps;
  const unlocked = () => library.security.isUnlocked();

  /** Every handler that takes a conversation id goes through this, so a locked session cannot read or
   * touch one that showed hidden content. */
  const accessible = (id: string) => manager.assertAccessible(store.getConversation(id));

  ipcMain.handle('assistant:getSettings', () => deps.getSettings());
  ipcMain.handle('assistant:setSettings', (_, partial: Partial<AssistantSettings>) => {
    assertMaxLength(partial.model, FIELD_LIMITS.name * 2, 'Model name');
    assertMaxLength(partial.styleGuide, MAX_STYLE_GUIDE_CHARS, 'Style guide');
    return deps.setSettings(partial);
  });

  ipcMain.handle('assistant:listConversations', () => store.listConversations(unlocked()));

  ipcMain.handle('assistant:createConversation', () => store.createConversation(deps.getSettings().model));

  ipcMain.handle('assistant:getConversation', (_, id: string) => {
    const conversation = accessible(id);
    return {
      conversation,
      messages: store.getMessages(id),
      proposals: store.listProposals(id),
      running: manager.isRunning(id),
    };
  });

  ipcMain.handle('assistant:renameConversation', (_, id: string, title: string) => {
    accessible(id);
    assertMaxLength(title, FIELD_LIMITS.conversationTitle, 'Title');
    return store.renameConversation(id, title);
  });

  ipcMain.handle('assistant:setModel', (_, id: string, model: string) => {
    accessible(id);
    assertMaxLength(model, FIELD_LIMITS.name * 2, 'Model name');
    return store.setModel(id, model);
  });

  ipcMain.handle('assistant:setNotes', (_, id: string, notes: string) => {
    accessible(id);
    return store.setNotes(id, notes);
  });

  ipcMain.handle('assistant:deleteConversation', (_, id: string) => {
    accessible(id);
    manager.cancel(id);
    store.deleteConversation(id);
    return { success: true };
  });

  ipcMain.handle('assistant:send', (event, request: { conversationId: string; content: string }) => {
    deps.assertNoSpeedTest();
    const sender = event.sender;
    const emit = (payload: AssistantStreamEvent) => {
      // The window can close mid-run; sending to a destroyed webContents throws.
      if (!sender.isDestroyed()) sender.send('assistant:stream', payload);
    };
    return manager.start(request.conversationId, request.content, emit);
  });

  ipcMain.handle('assistant:cancel', (_, id: string) => {
    accessible(id);
    manager.cancel(id);
    return { success: true };
  });

  // A proposal is applied only here, on the user's click. A failure (a limit, a target deleted since,
  // a hidden item while locked) is recorded on the proposal and returned, not thrown: the card shows
  // why, and 'failed' can be tried again once the cause is fixed.
  ipcMain.handle('assistant:applyProposal', (_, id: string) => {
    const proposal = store.getProposal(id);
    if (!proposal) throw new Error('Proposal not found.');
    accessible(proposal.conversationId);
    if (proposal.status === 'applied' || proposal.status === 'rejected') {
      throw new Error(`This proposal was already ${proposal.status}.`);
    }
    try {
      const message =
        proposal.action === 'create'
          ? applyCreate(library, proposal.payload as CreatePayload)
          : applyNewVersion(library, proposal.payload as NewVersionPayload);
      return { proposal: store.setProposalStatus(id, 'applied'), message };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { proposal: store.setProposalStatus(id, 'failed', message), message };
    }
  });

  ipcMain.handle('assistant:rejectProposal', (_, id: string) => {
    const proposal = store.getProposal(id);
    if (!proposal) throw new Error('Proposal not found.');
    accessible(proposal.conversationId);
    if (proposal.status === 'applied') throw new Error('This proposal was already applied.');
    return store.setProposalStatus(id, 'rejected');
  });
}
