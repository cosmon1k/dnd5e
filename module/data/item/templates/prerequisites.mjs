import SystemDataModel from "../../abstract/system-data-model.mjs";
import PrerequisiteData from "../prerequisite.mjs";

const { ArrayField, EmbeddedDataField, SchemaField } = foundry.data.fields;

/**
 * @import { PrerequisiteContext } from "../_types.mjs";
 * @import { PrerequisitesTemplateData } from "./_types.mjs";
 */

/**
 * Additional prerequisite conditions shared by features and facilities.
 * @extends {SystemDataModel<PrerequisitesTemplateData>}
 * @mixin
 */
export default class PrerequisitesTemplate extends SystemDataModel {

  /** @inheritDoc */
  static defineSchema() {
    return {
      prerequisites: new SchemaField({
        conditions: new ArrayField(new EmbeddedDataField(PrerequisiteData), { required: true })
      })
    };
  }

  /* -------------------------------------------- */

  /**
   * Top-level conditions displayed on the sheet.
   * @type {PrerequisiteData[]}
   */
  get prerequisiteConditions() {
    return this.prerequisites.conditions.filter(e => !e.group).sort((a, b) => a.sort - b.sort);
  }

  /* -------------------------------------------- */

  /**
   * Validate additional conditions.
   * @param {PrerequisiteContext} [context={}]
   * @returns {PrerequisiteValidationResults}
   */
  validatePrerequisites(context={}) {
    return PrerequisiteData.evaluate(this.prerequisites.conditions, { ...context, item: this.parent });
  }

  /* -------------------------------------------- */

  /**
   * Validate prerequisites and optionally report a failure.
   * @param {Actor5e} actor
   * @param {object} [options={}]
   * @param {Item5e[]} [options.added]
   * @param {Item5e[]} [options.removed]
   * @param {number} [options.level]
   * @param {boolean} [options.showMessage=false]
   * @param {boolean} [options.throwError=false]
   * @returns {true|string[]}
   */
  assertPrerequisites(actor, {
    added=[], removed=[], level=actor.system?.details?.level, showMessage=false, throwError=false
  }={}) {
    const results = this.validatePrerequisites({ actor, added, removed, level });
    const messages = Array.from(results).filter(([, r]) => r.valid === false)
      .map(([key, result]) => this._getPrerequisiteWarning(key, result));
    if ( !messages.length ) return true;
    if ( showMessage || throwError ) {
      const message = _loc("DND5E.Prerequisites.Warning.Message", {
        actor: actor.name,
        requirements: game.i18n.getListFormatter().format(messages),
        type: _loc(CONFIG.Item.typeLabels[this.parent.type]).toLowerCase()
      });
      if ( showMessage ) ui.notifications.warn(message);
      if ( throwError ) throw new Error(message);
    }
    return messages;
  }

  /* -------------------------------------------- */

  /**
   * Describe a failed prerequisite.
   * @param {string} key
   * @param {PrerequisiteValidationResult} result
   * @returns {string}
   * @protected
   */
  _getPrerequisiteWarning(key, result) {
    return _loc("DND5E.Prerequisites.Warning.Condition", { condition: result.label });
  }
}
