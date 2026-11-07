import PrerequisiteData from "../../../data/item/prerequisite.mjs";
import * as Trait from "../../../documents/actor/trait.mjs";
import DocumentSheet5e from "../../api/document-sheet.mjs";

/**
 * Configure nested prerequisite conditions using the starting equipment editor's layout.
 */
export default class PrerequisitesConfig extends DocumentSheet5e {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["prerequisites"],
    form: { submitOnChange: true },
    position: { width: 560 }
  };

  /** @override */
  static PARTS = {
    conditions: { template: "systems/dnd5e/templates/apps/prerequisites-config.hbs" }
  };

  /** @override */
  get title() {
    return _loc("DND5E.Prerequisites.Configure");
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.rootId = this.id;
    const proficiencies = [];
    for ( const trait of ["skills", "tool", "armor", "weapon"] ) {
      const choices = await Trait.choices(trait, { prefixed: true, any: true });
      proficiencies.push(...choices.asOptions({
        parentLabel: Trait.traitLabel(trait), includeCategories: ["armor", "weapon"].includes(trait)
      }));
    }
    const choices = {
      ability: Object.entries(CONFIG.DND5E.abilities).map(([value, a]) => ({ value, label: a.label })),
      size: Object.entries(CONFIG.DND5E.actorSizes).map(([value, s]) => ({ value, label: s.label })),
      proficiency: proficiencies,
      renown: dnd5e.registry.renown.factionOptions
    };
    const prepare = async (entry, depth=1, visited=new Set()) => {
      if ( visited.has(entry._id) || (depth > PrerequisiteData.MAX_DEPTH) ) return null;
      const ancestors = new Set([...visited, entry._id]);
      let keyOptions = choices[entry.type];
      if ( keyOptions && entry.key && !keyOptions.some(o => o.value === entry.key) ) {
        keyOptions = [...keyOptions, { value: entry.key, label: entry.key }];
      }
      const linked = ["item", "level"].includes(entry.type);
      let linkedUuid = entry.uuid;
      if ( linked && entry.key && !linkedUuid ) {
        const key = entry.type === "level" ? `class:${entry.key}` : entry.key;
        linkedUuid = game.items?.find(i => PrerequisiteData.matchesItem(i, key))?.uuid
          ?? dnd5e.registry.items.get(key)?.sources?.[0];
      }
      const linkedResolved = linkedUuid && fromUuidSync(linkedUuid, { strict: false });
      const linkedDocument = linkedUuid && !linkedResolved ? await fromUuid(linkedUuid) : null;
      return {
        entry, source: entry.toObject(), fields: entry.schema.fields, depth,
        prefix: `conditions.${entry._id}.`, keyOptions,
        linked, linkedUuid,
        linkedResolved, linkedAnchor: linkedDocument?.toAnchor().outerHTML,
        dropHint: entry.type === "level" ? "DND5E.Prerequisites.ClassHint" : "DND5E.StartingEquipment.DropHint",
        validTypes: depth < PrerequisiteData.MAX_DEPTH
          ? { ...PrerequisiteData.GROUPING_TYPES, ...PrerequisiteData.CONDITION_TYPES }
          : PrerequisiteData.CONDITION_TYPES,
        number: ["ability", "level", "renown"].includes(entry.type),
        numberLabel: entry.type === "level" ? "DND5E.LevelLimit.Min" : "DND5E.Minimum",
        text: ["text", "filter"].includes(entry.type),
        training: /^(skills|tool):/.test(entry.key) ? { 1: "DND5E.Proficient", 2: "DND5E.Expertise" }
          : { 1: "DND5E.Proficient" },
        children: (await Promise.all(entry.children.map(c => prepare(c, depth + 1, ancestors)))).filter(_ => _)
      };
    };
    context.entries = (await Promise.all(this.document.system.prerequisiteConditions.map(e => prepare(e))))
      .filter(_ => _);
    return context;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onRender(context, options) {
    super._onRender(context, options);
    new foundry.applications.ux.DragDrop.implementation({
      dragSelector: ".drag-bar",
      dropSelector: null,
      callbacks: {
        dragstart: this._onDragStart.bind(this),
        drop: this._onDrop.bind(this)
      }
    }).bind(this.element);
  }

  /* -------------------------------------------- */

  /** @override */
  _onClickAction(event, target) {
    const entryId = target.closest("[data-entry-id]")?.dataset.entryId;
    this.submit({ updateData: { action: target.dataset.action, entryId } });
  }

  /* -------------------------------------------- */

  /** @override */
  _prepareSubmitData(event, form, formData, updateData) {
    const data = this._processFormData(event, form, formData);
    if ( updateData ) foundry.utils.mergeObject(data, updateData, { inplace: true, applyOperators: true });
    return data;
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _processSubmitData(event, form, submitData) {
    const { action, entryId, moveEntryId, groupId, linkedKey, linkedUuid } = submitData;
    let entries = this.document.system.prerequisites.conditions.map(e => {
      const entry = foundry.utils.mergeObject(e.toObject(), submitData.conditions?.[e._id] ?? {}, { inplace: false });
      entry.group ||= null;
      return entry;
    });
    const descendants = id => {
      const ids = new Set([id]);
      const visit = parent => {
        for ( const child of entries.filter(e => e.group === parent) ) {
          if ( ids.has(child._id) ) continue;
          ids.add(child._id);
          visit(child._id);
        }
      };
      visit(id);
      return ids;
    };
    for ( const entry of entries ) {
      if ( (entry.type === "proficiency") && !/^(skills|tool):/.test(entry.key) ) entry.value = 1;
      const original = this.document.system.prerequisites.conditions.find(e => e._id === entry._id);
      if ( entry.type === original.type ) continue;
      if ( !(entry.type in PrerequisiteData.GROUPING_TYPES) && original.isGroup ) {
        const ids = descendants(entry._id);
        entries = entries.filter(e => (e._id === entry._id) || !ids.has(e._id));
      }
      entry.key = "";
      entry.uuid = null;
    }
    const highestSort = entries.reduce((sort, e) => Math.max(sort, e.sort), 0);
    if ( ["add-entry", "add-group"].includes(action) || linkedKey ) entries.push({
      _id: foundry.utils.randomID(), group: entryId ?? null,
      sort: highestSort + CONST.SORT_INTEGER_DENSITY,
      type: action === "add-group" ? "AND" : "item", key: linkedKey ?? "", uuid: linkedUuid
    });
    else if ( action === "delete-entry" ) {
      const ids = descendants(entryId);
      entries = entries.filter(e => !ids.has(e._id));
    }
    else if ( action === "clear-document" ) {
      const entry = entries.find(e => e._id === entryId);
      if ( entry ) {
        entry.key = "";
        entry.uuid = null;
      }
    }
    if ( moveEntryId ) {
      const entry = entries.find(e => e._id === moveEntryId);
      if ( !entry || descendants(moveEntryId).has(groupId) ) return;
      entry.group = groupId ?? null;
      entry.sort = highestSort + CONST.SORT_INTEGER_DENSITY;
    }
    const model = this.document.system.clone({ "prerequisites.conditions": entries });
    if ( model.validatePrerequisites().has("condition:invalid") ) {
      ui.notifications.warn("DND5E.Prerequisites.Invalid");
      return;
    }
    return super._processSubmitData(event, form, { "system.prerequisites.conditions": entries });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onDragStart(event) {
    const entryId = event.target.closest("[data-entry-id]")?.dataset.entryId;
    if ( !entryId ) return;
    event.dataTransfer.setData("text/plain", JSON.stringify({
      type: "prerequisite-entry", uuid: this.document.uuid, entryId
    }));
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const target = event.target.closest("[data-entry-id]")?.dataset.entryId;
    const entry = this.document.system.prerequisites.conditions.find(e => e._id === target);
    const groupId = entry?.isGroup ? entry._id : entry?.group;
    if ( (data.type === "prerequisite-entry") && (data.uuid === this.document.uuid) ) {
      return this.submit({ updateData: { moveEntryId: data.entryId, groupId } });
    }
    if ( data.type !== "Item" ) return;
    const item = await Item.implementation.fromDropData(data);
    if ( !item?.identifier ) return;
    if ( entry?.type === "level" && (item.type !== "class") ) {
      ui.notifications.warn("DND5E.ADVANCEMENT.ItemChoice.Warning.InvalidType", {
        format: { type: _loc("TYPES.Item.class") }
      });
      return;
    }
    if ( ["item", "level"].includes(entry?.type) ) return this.submit({ updateData: {
      [`conditions.${entry._id}.key`]: entry.type === "level" ? item.identifier : `${item.type}:${item.identifier}`,
      [`conditions.${entry._id}.uuid`]: item.uuid
    } });
    return this.submit({ updateData: {
      entryId: groupId, linkedKey: `${item.type}:${item.identifier}`, linkedUuid: item.uuid
    } });
  }
}
