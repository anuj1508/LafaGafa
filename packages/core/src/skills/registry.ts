import type { Skill } from "./types.js";

/**
 * The whole extensibility claim in one class: a skill becomes available by being registered, and
 * the loop reads the registry rather than naming skills. Nothing in `core` knows what
 * `book_appointment` is.
 */
export class SkillRegistry {
  readonly #skills = new Map<string, Skill<never>>();

  register<I>(skill: Skill<I>): this {
    if (this.#skills.has(skill.name)) {
      throw new Error(`Skill "${skill.name}" is already registered`);
    }
    this.#skills.set(skill.name, skill as Skill<never>);
    return this;
  }

  get(name: string): Skill<never> | undefined {
    return this.#skills.get(name);
  }

  /** The skills the model may call this turn — anything the operator disabled is simply absent. */
  enabled(toggles: Record<string, boolean>): Skill<never>[] {
    return [...this.#skills.values()].filter((skill) => toggles[skill.name] !== false);
  }
}
