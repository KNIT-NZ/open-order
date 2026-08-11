// lib/concept-registry.ts
import type { AuthorityClass } from "@/lib/procedural-reasoning";

export type ProceduralConceptId =
  | "closure_motion"
  | "point_of_order"
  | "personal_reflection"
  | "allegation_of_racism"
  | "relevancy"
  | "chair_control"
  | "committee_of_whole"
  | "withdrawal_and_apology"
  | "ministerial_accountability"
  | "retrospective_discipline";

export type AuthoritySlotSpec = {
  key: string;
  classes?: AuthorityClass[];
  headings?: string[];
  pathIncludes?: string[];
  preferredCorpora?: Array<"standing_orders" | "speakers_rulings">;
  maxMatches?: number;
};

export type AuthorityExclusionSpec = {
  headings?: string[];
  pathIncludes?: string[];
};

export type ProceduralConcept = {
  id: ProceduralConceptId;
  aliases: string[];
  preferredQueries: string[];
  slots: AuthoritySlotSpec[];
  exclusions?: AuthorityExclusionSpec[];
  defaultPackContribution?: number;
};

export const CONCEPT_REGISTRY: ProceduralConcept[] = [
  {
    id: "closure_motion",
    aliases: [
      "question be put",
      "question to be put",
      "closure",
      "premature closure",
    ],
    preferredQueries: ["closure motion", "acceptance of closure motion"],
    defaultPackContribution: 3,
    slots: [
      {
        key: "closure_governing_rule",
        headings: ["closure motion"],
        classes: ["governing_rule"],
        preferredCorpora: ["standing_orders"],
        maxMatches: 1,
      },
      {
        key: "closure_qualification",
        headings: ["acceptance of closure motion", "effect of carrying closure motion"],
        classes: ["constraint_or_qualification"],
        preferredCorpora: ["standing_orders"],
        maxMatches: 1,
      },
    ],
  },
  {
    id: "point_of_order",
    aliases: ["point of order"],
    preferredQueries: ["point of order"],
    defaultPackContribution: 1,
    slots: [
      {
        key: "point_of_order_mechanism",
        headings: ["points of order", "point of order"],
        classes: ["procedural_mechanism"],
        maxMatches: 1,
      },
    ],
  },
  {
    id: "personal_reflection",
    aliases: [
      "personal attack",
      "attack on member",
      "right to speak",
      "personal reflection",
      "personal reflections",
    ],
    preferredQueries: ["personal reflections", "against members", "procedure"],
    defaultPackContribution: 3,
    slots: [
      {
        key: "personal_reflection_rule",
        pathIncludes: ["personal reflections"],
        headings: ["against members"],
        classes: ["governing_rule"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
      {
        key: "personal_reflection_procedure",
        pathIncludes: ["personal reflections"],
        headings: ["procedure"],
        classes: ["constraint_or_qualification"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
    ],
  },
  {
    id: "allegation_of_racism",
    aliases: ["racist", "racism", "country of origin", "ethnicity", "nationality"],
    preferredQueries: ["allegations of racism"],
    defaultPackContribution: 2,
    slots: [
      {
        key: "racism_rule",
        headings: ["allegations of racism"],
        classes: ["governing_rule"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
    ],
  },
  {
    id: "relevancy",
    aliases: ["evasive", "evasiveness", "off topic", "not relevant", "relevancy"],
    preferredQueries: ["relevancy"],
    defaultPackContribution: 2,
    slots: [
      {
        key: "relevancy_rule",
        headings: ["relevancy"],
        classes: ["governing_rule"],
        maxMatches: 1,
      },
    ],
  },
  {
    id: "chair_control",
    aliases: ["chair", "chairperson", "speaker control"],
    preferredQueries: ["chairperson"],
    defaultPackContribution: 2,
    slots: [
      {
        key: "chair_control_rule",
        headings: ["chairperson"],
        classes: ["chair_control"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
    ],
  },
  {
    id: "committee_of_whole",
    aliases: ["committee of the whole", "committee stage"],
    preferredQueries: ["committee of the whole", "chairperson"],
    defaultPackContribution: 2,
    slots: [
      {
        key: "committee_of_whole_context",
        pathIncludes: ["committees of the whole house"],
        preferredCorpora: ["standing_orders", "speakers_rulings"],
        maxMatches: 1,
      },
    ],
    exclusions: [
      {
        pathIncludes: ["chairpersons of select committees"],
      },
    ],
  },
  {
    id: "withdrawal_and_apology",
    aliases: ["withdraw", "apologise", "apology", "withdrawal"],
    preferredQueries: ["withdrawal", "procedure"],
    defaultPackContribution: 2,
    slots: [
      {
        key: "withdrawal_rule",
        headings: ["withdrawal"],
        classes: ["constraint_or_qualification", "governing_rule"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
      {
        key: "withdrawal_procedure",
        headings: ["procedure"],
        classes: ["constraint_or_qualification"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
    ],
  },
  {
    id: "ministerial_accountability",
    aliases: [
      "areas of responsibility",
      "avoid directly answering",
      "abdication of responsibility",
      "account to the house",
      "accountability to the house",
      "evasive answer",
      "non-answer",
    ],
    preferredQueries: ["accountability to the House", "form of reply", "point of order"],
    defaultPackContribution: 3,
    slots: [
      {
        key: "ministerial_accountability_rule",
        headings: ["accountability to the house"],
        classes: ["governing_rule"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
      {
        key: "ministerial_form_of_reply",
        headings: ["form of reply"],
        classes: ["constraint_or_qualification"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
    ],
  },
  {
    id: "retrospective_discipline",
    aliases: [
      "yesterday",
      "previous sitting",
      "something that happened in the house yesterday",
      "require a member to apologise",
      "require an apology",
      "apology for something that happened",
    ],
    preferredQueries: ["withdrawal", "procedure", "point of order"],
    defaultPackContribution: 3,
    slots: [
      {
        key: "retrospective_withdrawal",
        headings: ["withdrawal"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
      {
        key: "retrospective_procedure",
        headings: ["procedure"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
    ],
  },
];