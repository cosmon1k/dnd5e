import * as Trait from "../../documents/actor/trait.mjs";
import { formatNumber } from "../../utils.mjs";
import FiltersField from "../fields/filters-field.mjs";

const { DocumentIdField, DocumentUUIDField, IntegerSortField, NumberField, StringField } = foundry.data.fields;
const PREFIX = "DND5E.Prerequisites";

/**
 * @import { PrerequisiteContext } from "./_types.mjs";
 * @import { Filter } from "../../filter.mjs";
 */

/**
 * A prerequisite condition or a group of conditions.
 * @property {string} _id        Unique entry ID.
 * @property {string|null} group Parent group ID.
 * @property {number} sort       Display order.
 * @property {string} type       Condition or group type.
 * @property {string} key        Ability, identifier, proficiency, size, or faction to check.
 * @property {string|null} uuid  Optional item reference for display, independent of identifier matching.
 * @property {number} value      Minimum score, level, or proficiency.
 * @property {string} text       Description of an informational or custom requirement.
 * @property {Filter} filter     Custom actor filter.
 */
export default class PrerequisiteData extends foundry.abstract.DataModel {

  /** @enum {string} */
  static GROUPING_TYPES = {
    AND: "DND5E.StartingEquipment.Operator.AND",
    OR: "DND5E.StartingEquipment.Operator.OR",
    NOT: `${PREFIX}.Condition.None`
  };

  /** @enum {string} */
  static CONDITION_TYPES = {
    ability: "DND5E.AbilityScore",
    level: "DND5E.Level",
    item: `${PREFIX}.Condition.Item`,
    spellcasting: `${PREFIX}.Condition.Spellcasting`,
    spell: `${PREFIX}.Condition.Spell`,
    size: "DND5E.Size",
    proficiency: "DND5E.Proficiency",
    renown: "TYPES.Item.renown",
    filter: `${PREFIX}.Condition.Filter`,
    text: `${PREFIX}.Condition.Text`
  };

  /** @type {number} */
  static MAX_DEPTH = 4;

  /** @inheritDoc */
  static defineSchema() {
    return {
      _id: new DocumentIdField({ initial: () => foundry.utils.randomID() }),
      group: new StringField({ nullable: true, initial: null }),
      sort: new IntegerSortField(),
      type: new StringField({ required: true, blank: false, initial: "item",
        choices: { ...this.GROUPING_TYPES, ...this.CONDITION_TYPES } }),
      key: new StringField(),
      uuid: new DocumentUUIDField({ type: "Item" }),
      value: new NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 1 }),
      text: new StringField(),
      filter: new FiltersField()
    };
  }

  /* -------------------------------------------- */

  /**
   * Whether this entry groups other conditions.
   * @type {boolean}
   */
  get isGroup() {
    return this.type in this.constructor.GROUPING_TYPES;
  }

  /* -------------------------------------------- */

  /**
   * Child conditions, in display order.
   * @type {PrerequisiteData[]}
   */
  get children() {
    return this.isGroup ? (this.parent?.prerequisites?.conditions ?? [])
      .filter(e => e.group === this._id).sort((a, b) => a.sort - b.sort) : [];
  }

  /* -------------------------------------------- */

  /**
   * A human-readable description of this condition.
   * @type {string}
   */
  get label() {
    return this.generateLabel();
  }

  /* -------------------------------------------- */

  /**
   * Describe a condition without evaluating it.
   * @param {Set<string>} [visited]  Ancestor IDs, used to guard against malformed trees.
   * @returns {string}
   */
  generateLabel(visited=new Set()) {
    if ( visited.has(this._id) || (visited.size >= this.constructor.MAX_DEPTH) ) return _loc(`${PREFIX}.Invalid`);
    if ( this.isGroup ) {
      const ancestors = new Set([...visited, this._id]);
      const children = this.children.map(c => c.generateLabel(ancestors));
      if ( !children.length ) return _loc(`${PREFIX}.EmptyGroup`);
      const conditions = game.i18n.getListFormatter({
        type: this.type === "AND" ? "conjunction" : "disjunction"
      }).format(children);
      return _loc(`${PREFIX}.Display.${this.type}`, { conditions });
    }
    const key = this.key || _loc(`${PREFIX}.Unspecified`);
    const value = formatNumber(this.value);
    const linkedName = this.uuid ? fromUuidSync(this.uuid, { strict: false })?.name : null;
    switch ( this.type ) {
      case "ability":
        return _loc(`${PREFIX}.Display.Ability`, { ability: CONFIG.DND5E.abilities[this.key]?.label ?? key, value });
      case "level":
        return this.key ? _loc(`${PREFIX}.Display.ClassLevel`, {
          name: linkedName ?? dnd5e.registry.items.get(this.key, { type: "class" })?.name ?? key, value
        }) : _loc(`${PREFIX}.FIELDS.prerequisites.level.display`, { level: value });
      case "item": return linkedName ?? dnd5e.registry.items.get(this.key)?.name ?? key;
      case "spellcasting": return _loc(`${PREFIX}.Condition.Spellcasting`);
      case "spell": return _loc(`${PREFIX}.Condition.Spell`);
      case "size": return _loc(`${PREFIX}.Display.Size`, { size: CONFIG.DND5E.actorSizes[this.key]?.label ?? key });
      case "proficiency": return _loc(`${PREFIX}.Display.${this.value > 1 ? "Expertise" : "Proficiency"}`, {
        name: Trait.keyLabel(this.key)
      });
      case "renown": return _loc(`${PREFIX}.Display.Renown`, {
        name: dnd5e.registry.renown.get(this.key)?.name ?? key, value
      });
      case "filter": return this.text || _loc(`${PREFIX}.Condition.Filter`);
      case "text": return this.text || _loc(`${PREFIX}.Unspecified`);
      default: return _loc(`${PREFIX}.Invalid`);
    }
  }

  /* -------------------------------------------- */

  /**
   * Evaluate a condition. Unknown conditions remain unknown through groups and negation.
   * @param {PrerequisiteContext} context
   * @returns {boolean|null}
   */
  evaluate(context) {
    if ( this.isGroup ) {
      const values = this.children.map(c => c.evaluate(context));
      if ( !values.length ) return null;
      if ( this.type === "AND" ) return values.includes(false) ? false : values.includes(null) ? null : true;
      const any = values.includes(true) ? true : values.includes(null) ? null : false;
      return (this.type === "NOT") && (any !== null) ? !any : any;
    }
    const { actor, items } = context;
    if ( !actor || (this.type === "text") ) return null;
    const minimum = n => Number.isFinite(n) ? n >= this.value : null;
    switch ( this.type ) {
      case "ability": return this.key ? minimum(actor.system.abilities?.[this.key]?.value) : null;
      case "level": return this.key
        ? minimum(items.find(i => (i.type === "class") && (i.identifier === this.key))?.system.levels ?? 0)
        : minimum(actor.system.details?.level);
      case "item": return this.key ? items.some(i => this.constructor.matchesItem(i, this.key)) : null;
      case "spellcasting": return items.some(i => ["spellcasting", "pact-magic"].includes(i.identifier));
      case "spell": return items.some(i => i.type === "spell");
      case "size": return this.key && actor.system.traits?.size ? actor.system.traits.size === this.key : null;
      case "proficiency": return this.#checkProficiency(actor);
      case "renown": {
        if ( !this.key ) return null;
        const score = items.filter(i => i.type === "renown").reduce((total, i) => total
          + (i.system.modifiers ?? []).filter(m => m.faction === this.key).reduce((n, m) => n + m.value, 0), 0);
        return minimum(score);
      }
      case "filter": return !this.filter || foundry.utils.isEmpty(JSON.parse(this._source.filter))
        ? null : this.filter?.check(actor) ?? null;
      default: return false;
    }
  }

  /* -------------------------------------------- */

  /**
   * Check a skill, tool, armor, or weapon proficiency, including wildcard categories.
   * @param {Actor5e} actor
   * @returns {boolean|null}
   */
  #checkProficiency(actor) {
    const [trait, ...parts] = this.key.split(":");
    const key = parts.at(-1);
    if ( !key ) return null;
    if ( ["skills", "tool"].includes(trait) ) {
      const data = actor.system[trait === "tool" ? "tools" : "skills"];
      if ( !data ) return null;
      if ( key !== "*" ) return (data[key]?.value ?? 0) >= this.value;
      const category = parts.at(-2);
      return Object.entries(data).some(([k, d]) => {
        if ( d.value < this.value ) return false;
        if ( !category ) return true;
        if ( (category === "vehicle") && (k in CONFIG.DND5E.vehicleTypes) ) return true;
        const id = CONFIG.DND5E.tools[k]?.id;
        const item = id ? Trait.getBaseItem(id, { indexOnly: true }) : null;
        return item?.system.type?.value === category;
      });
    }
    if ( !["armor", "weapon"].includes(trait) ) return false;
    const values = actor.system.traits?.[`${trait}Prof`]?.value;
    if ( !values ) return null;
    if ( this.value > 1 ) return false;
    if ( key !== "*" && values.has(key) ) return true;
    if ( (key === "*") && !parts.slice(0, -1).length ) return !!values.size;
    const category = parts.at(-2);
    const config = CONFIG.DND5E.traits[trait];
    const categoryFor = k => {
      for ( const ids of config.subtypes?.ids ?? [] ) {
        const id = CONFIG.DND5E[ids]?.[k];
        if ( !id ) continue;
        const data = Trait.getBaseItem(id.id ?? id, { indexOnly: true });
        const type = data?.system.type?.value;
        return CONFIG.DND5E[`${trait}ProficienciesMap`]?.[type];
      }
    };
    if ( key === "*" ) return values.has(category) || Array.from(values).some(k => categoryFor(k) === category);
    const parent = categoryFor(key);
    return parent ? values.has(parent) : false;
  }

  /* -------------------------------------------- */

  /**
   * Match a typed or untyped item identifier.
   * @param {Item5e} item
   * @param {string} key
   * @returns {boolean}
   */
  static matchesItem(item, key) {
    if ( key.split(":").length > 2 ) return false;
    const [type, identifier] = key.includes(":") ? key.split(":", 2) : [null, key];
    return (!type || (item.type === type)) && (item.identifier === identifier);
  }

  /* -------------------------------------------- */

  /**
   * Evaluate a collection while rejecting orphaned, cyclic, or over-nested conditions.
   * @param {PrerequisiteData[]} entries
   * @param {PrerequisiteContext} context
   * @returns {PrerequisiteValidationResults}
   */
  static evaluate(entries, context={}) {
    const results = new Map();
    if ( !entries.length ) return results;
    const byId = new Map(entries.map(e => [e._id, e]));
    const visited = new Set();
    const visit = (entry, depth=1) => {
      if ( visited.has(entry._id) || (depth > this.MAX_DEPTH) ) return false;
      visited.add(entry._id);
      return entry.children.every(c => visit(c, depth + 1));
    };
    const roots = entries.filter(e => !e.group).sort((a, b) => a.sort - b.sort);
    const valid = (byId.size === entries.length)
      && entries.every(e => !e.group || byId.get(e.group)?.isGroup)
      && roots.every(e => visit(e)) && (visited.size === entries.length);
    if ( !valid ) return results.set("condition:invalid", { label: _loc(`${PREFIX}.Invalid`), valid: false });
    const { actor, added=[], removed=[], item } = context;
    const removedIds = new Set([removed].flat().flatMap(i => [i?.id, i?.uuid]).filter(_ => _));
    const source = item?._stats?.compendiumSource ?? item?.uuid;
    const inventory = new Map([...(actor?.items ?? []), ...added].map(i => [i.uuid ?? i.id ?? i, i]));
    const items = Array.from(inventory.values()).filter(i => !removedIds.has(i.id)
      && !removedIds.has(i.uuid) && (i !== item) && (!item?.uuid || (i.uuid !== item.uuid))
      && (!source || (i._stats?.compendiumSource !== source)));
    for ( const entry of roots ) results.set(`condition:${entry._id}`, {
      label: entry.label, valid: entry.evaluate({ ...context, items })
    });
    return results;
  }
}
