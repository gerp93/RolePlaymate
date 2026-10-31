/**
 * Applies an approved assistant proposal to the library -- the only place the assistant's work ever
 * writes. Each change goes through the same service methods the editors use, so it is subject to the
 * same rules (active tracks the latest version, field limits, unique persona names) and a "new
 * version" never destroys the text it replaces.
 *
 * Everything runs inside one transaction, so a proposal that fails halfway leaves nothing behind.
 */
import { transaction } from '../database/schema';
import {
  guardCharacterCreate,
  guardGreeting,
  guardPersonaCreate,
  guardProseContent,
  guardScenarioContent,
  guardScenarioCreate,
} from '../fieldLengthGuards';
import { FIELD_TYPES, FieldType } from '../../shared/types/characterField';
import { CreatePayload, NewVersionPayload } from '../../shared/types/assistant';
import type { LibraryServices } from './assistantLibrary';

/** Errors the user can act on (as opposed to bugs): shown on the proposal card as-is. */
export class ProposalError extends Error {}

function assertVisible(s: LibraryServices, hidden: boolean, what: string): void {
  if (hidden && !s.security.isUnlocked()) {
    throw new ProposalError(`${what} is hidden. Unlock hidden items first.`);
  }
}

export function applyNewVersion(s: LibraryServices, p: NewVersionPayload): string {
  return transaction(s.db, () => {
    if (p.entity === 'character') {
      const character = s.characters.getCharacterById(p.entityId);
      if (!character) throw new ProposalError(`The character "${p.entityName}" no longer exists.`);
      assertVisible(s, character.isHidden, `"${character.name}"`);
      guardProseContent(p.after, p.field === 'dialogue' ? 'Example dialogue' : 'Personality');
      const type = p.field as FieldType;
      let field = s.fields.getFieldsByCharacter(character.id).find((f) => f.fieldType === type);
      if (!field) field = s.fields.createField(character.id, type);
      const versions = s.fieldVersions.getVersionsByField(field.id);
      if (versions.length === 0) {
        s.fieldVersions.createVersion({ fieldId: field.id, content: p.after });
      } else {
        const latest = versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
        const created = s.fieldVersions.duplicateVersion(latest.id);
        s.fieldVersions.updateVersionContent(created.id, p.after);
      }
      return `Saved a new ${p.field} version for ${character.name}.`;
    }

    if (p.entity === 'persona') {
      const persona = s.conversations.getPersona(p.entityId);
      if (!persona) throw new ProposalError(`The persona "${p.entityName}" no longer exists.`);
      assertVisible(s, persona.isHidden, `"${persona.name}"`);
      guardProseContent(p.after, 'Background');
      const versions = s.personaVersions.getVersionsByPersona(persona.id);
      if (versions.length === 0) {
        s.personaVersions.createVersion(persona.id, p.after);
      } else {
        const latest = versions.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a));
        const created = s.personaVersions.duplicateVersion(latest.id);
        s.personaVersions.updateVersionContent(created.id, p.after);
      }
      return `Saved a new background version for ${persona.name}.`;
    }

    const scenario = s.scenarios.getScenario(p.entityId);
    if (!scenario) throw new ProposalError(`The scenario "${p.entityName}" no longer exists.`);
    const owner = scenario.characterId ? s.characters.getCharacterById(scenario.characterId) : null;
    assertVisible(s, scenario.isHidden || !!owner?.isHidden, `"${scenario.name}"`);
    if (p.field === 'greeting') {
      guardGreeting(p.after);
      s.scenarios.createGreetingVersion(scenario.id, p.after);
    } else {
      guardScenarioContent(p.after);
      s.scenarios.createVersion(scenario.id, p.after);
    }
    return `Saved a new ${p.field === 'greeting' ? 'opening greeting' : 'scenario text'} version for ${scenario.name}.`;
  });
}

export function applyCreate(s: LibraryServices, p: CreatePayload): string {
  return transaction(s.db, () => {
    if (p.entity === 'character') {
      guardCharacterCreate({ name: p.name, description: p.description });
      const character = s.characters.createCharacter({ name: p.name, description: p.description || undefined });
      // Same fixed set of fields, each with a first version, that characters:create makes.
      for (const type of FIELD_TYPES) {
        const field = s.fields.createField(character.id, type);
        const content = (p.fields[type] ?? '').trim();
        guardProseContent(content, type === 'dialogue' ? 'Example dialogue' : 'Personality');
        s.fieldVersions.createVersion({ fieldId: field.id, content });
      }
      return `Created the character ${character.name}.`;
    }

    if (p.entity === 'persona') {
      guardPersonaCreate({ name: p.name, description: p.description, background: p.fields.background });
      if (s.conversations.listPersonas().some((x) => x.name.toLowerCase() === p.name.toLowerCase())) {
        throw new ProposalError(`A persona named "${p.name}" already exists.`);
      }
      const persona = s.conversations.createPersona({
        name: p.name,
        description: p.description || undefined,
        background: p.fields.background ?? '',
      });
      return `Created the persona ${persona.name}.`;
    }

    const input = { characterId: p.ownerCharacterId, groupId: p.ownerGroupId, name: p.name, description: p.description || undefined };
    guardScenarioCreate(input);
    if (p.ownerCharacterId) {
      const owner = s.characters.getCharacterById(p.ownerCharacterId);
      if (!owner) throw new ProposalError(`The character "${p.ownerName}" no longer exists.`);
      assertVisible(s, owner.isHidden, `"${owner.name}"`);
    } else if (p.ownerGroupId) {
      const owner = s.groups.getGroupById(p.ownerGroupId);
      if (!owner) throw new ProposalError(`The group "${p.ownerName}" no longer exists.`);
      assertVisible(s, owner.isHidden, `"${owner.name}"`);
    } else {
      throw new ProposalError('A scenario needs a character or group to belong to.');
    }
    const scenario = s.scenarios.createScenario(
      p.ownerCharacterId ? { characterId: p.ownerCharacterId } : { groupId: p.ownerGroupId! },
      p.name,
      p.description || undefined
    );
    // createScenario seeds a blank first version of each text; fill those rather than stacking a v2.
    if (p.fields.content) {
      guardScenarioContent(p.fields.content);
      s.scenarios.updateVersionContent(s.scenarios.getVersions(scenario.id)[0].id, p.fields.content);
    }
    if (p.fields.greeting) {
      guardGreeting(p.fields.greeting);
      s.scenarios.updateGreetingVersionContent(s.scenarios.getGreetingVersions(scenario.id)[0].id, p.fields.greeting);
    }
    return `Created the scenario ${scenario.name} for ${p.ownerName ?? 'its owner'}.`;
  });
}
