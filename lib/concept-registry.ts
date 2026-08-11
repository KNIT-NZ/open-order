// lib/concept-registry.ts
import type {
  AuthorityClass,
  AuthorityFunction,
} from "@/lib/procedural-reasoning";

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

export type AuthorityContextPreference = {
  whenAnyConcepts?: ProceduralConceptId[];
  whenAllConcepts?: ProceduralConceptId[];
  textIncludes: string[];
  bonusPerMatch?: number;
};

export type AuthoritySlotSpec = {
  key: string;
  requirement?: "required" | "optional";
  classes?: AuthorityClass[];
  functions?: AuthorityFunction[];
  headings?: string[];
  pathIncludes?: string[];
  preferredCorpora?: Array<"standing_orders" | "speakers_rulings">;
  requiredTextIncludes?: string[];
  recoveryQueries?: string[];
  recoveryCorpora?: Array<"standing_orders" | "speakers_rulings">;
  evidenceGapDescription?: string;
  preferredTextIncludes?: string[];
  contextualTextPreferences?: AuthorityContextPreference[];
  maxMatches?: number;
};

export type AuthorityExclusionSpec = {
  headings?: string[];
  pathIncludes?: string[];
};

export type ProceduralConcept = {
  id: ProceduralConceptId;
  aliases: string[];
  plannerTriggers?: string[];
  preferredQueries: string[];
  slots: AuthoritySlotSpec[];
  exclusions?: AuthorityExclusionSpec[];
  supersedesSlots?: string[];
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
    plannerTriggers: ["closure motion", "acceptance of closure motion"],
    preferredQueries: ["closure motion", "acceptance of closure motion"],
    defaultPackContribution: 3,
    slots: [
      {
        key: "closure_governing_rule",
        requirement: "required",
        headings: ["closure motion"],
        classes: ["governing_rule"],
        functions: ["rule", "application"],
        preferredCorpora: ["standing_orders"],
        maxMatches: 1,
      },
      {
        key: "closure_qualification",
        requirement: "optional",
        headings: ["acceptance of closure motion", "effect of carrying closure motion"],
        classes: ["constraint_or_qualification"],
        functions: ["constraint", "effect"],
        preferredCorpora: ["standing_orders"],
        maxMatches: 1,
      },
    ],
  },
  {
    id: "point_of_order",
    aliases: ["point of order", "points of order"],
    plannerTriggers: ["point of order", "points of order"],
    preferredQueries: ["point of order"],
    defaultPackContribution: 1,
    slots: [
      {
        key: "point_of_order_mechanism",
        requirement: "optional",
        headings: ["points of order", "point of order"],
        classes: ["procedural_mechanism"],
        functions: ["procedure"],
        preferredTextIncludes: [
          "speaker can take action",
        ],
        contextualTextPreferences: [
          {
            whenAnyConcepts: [
              "personal_reflection",
              "allegation_of_racism",
              "relevancy",
            ],
            textIncludes: [
              "transgressing the rules of debate",
              "breach of the rules",
              "call the attention of the speaker",
              "draw the speaker's attention",
            ],
            bonusPerMatch: 260,
          },
        ],
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
    plannerTriggers: ["personal reflections", "against members"],
    preferredQueries: ["personal reflections", "against members", "procedure"],
    defaultPackContribution: 3,
    slots: [
      {
        key: "personal_reflection_rule",
        requirement: "required",
        pathIncludes: ["personal reflections"],
        headings: ["against members"],
        classes: ["governing_rule"],
        functions: ["rule", "application"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
      {
        key: "personal_reflection_procedure",
        requirement: "optional",
        pathIncludes: ["personal reflections"],
        headings: ["procedure"],
        classes: ["constraint_or_qualification"],
        functions: ["procedure", "constraint"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
    ],
  },
  {
    id: "allegation_of_racism",
    aliases: ["racist", "racism", "country of origin", "ethnicity", "nationality"],
    plannerTriggers: ["allegations of racism"],
    preferredQueries: ["allegations of racism"],
    supersedesSlots: ["personal_reflection_rule"],
    defaultPackContribution: 2,
    slots: [
      {
        key: "racism_rule",
        requirement: "required",
        headings: ["allegations of racism"],
        classes: ["governing_rule"],
        functions: ["rule", "application"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
    ],
  },
  {
    id: "relevancy",
    aliases: ["evasive", "evasiveness", "off topic", "not relevant", "relevancy"],
    plannerTriggers: ["relevancy"],
    preferredQueries: ["relevancy"],
    defaultPackContribution: 2,
    slots: [
      {
        key: "relevancy_rule",
        requirement: "required",
        headings: ["relevancy"],
        classes: ["governing_rule"],
        functions: ["rule", "application"],
        maxMatches: 1,
      },
    ],
  },
  {
    id: "chair_control",
    aliases: ["chair", "chairperson", "speaker control"],
    plannerTriggers: ["chairperson"],
    preferredQueries: ["chairperson"],
    defaultPackContribution: 2,
    slots: [
      {
        key: "chair_control_rule",
        requirement: "required",
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
    plannerTriggers: ["committee of the whole", "committee stage"],
    preferredQueries: ["committee of the whole", "chairperson"],
    defaultPackContribution: 2,
    slots: [
      {
        key: "committee_of_whole_context",
        requirement: "required",
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
    plannerTriggers: ["withdrawal"],
    preferredQueries: ["withdrawal", "procedure"],
    defaultPackContribution: 2,
    slots: [
      {
        key: "withdrawal_rule",
        requirement: "required",
        headings: ["withdrawal"],
        pathIncludes: ["unparliamentary language"],
        classes: ["constraint_or_qualification", "governing_rule"],
        functions: ["procedure", "constraint", "rule", "application"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
      {
        key: "withdrawal_procedure",
        requirement: "optional",
        headings: ["procedure"],
        pathIncludes: ["unparliamentary language"],
        classes: ["constraint_or_qualification"],
        functions: ["procedure", "constraint"],
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
    plannerTriggers: ["accountability to the house", "form of reply"],
    preferredQueries: ["accountability to the House", "form of reply", "point of order"],
    defaultPackContribution: 3,
    slots: [
      {
        key: "ministerial_accountability_rule",
        requirement: "required",
        headings: ["accountability to the house"],
        classes: ["governing_rule"],
        functions: ["rule", "application"],
        preferredCorpora: ["speakers_rulings"],
        maxMatches: 1,
      },
      {
        key: "ministerial_form_of_reply",
        requirement: "optional",
        headings: ["form of reply"],
        classes: ["constraint_or_qualification"],
        functions: ["constraint", "rule", "application"],
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
    preferredQueries: [
      "withdrawal",
      "procedure",
      "point of order",
      "previous sitting",
    ],
    defaultPackContribution: 2,
    slots: [
      {
        key: "retrospective_timing_rule",
        requirement: "required",
        pathIncludes: ["rules of debate", "maintenance of order"],
        preferredCorpora: ["standing_orders", "speakers_rulings"],
        requiredTextIncludes: [
          "previous sitting",
          "earlier sitting",
          "previous day",
          "earlier day",
          "at an earlier sitting",
          "at a previous sitting",
        ],
        recoveryQueries: [
          "previous sitting",
          "earlier sitting",
          "previous day",
        ],
        recoveryCorpora: ["speakers_rulings", "standing_orders"],
        evidenceGapDescription:
          "whether the Speaker may require withdrawal or an apology for conduct from an earlier sitting",
        maxMatches: 1,
      },
    ],
  },
];