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

export type ProceduralConcept = {
  id: ProceduralConceptId;
  aliases: string[];
  preferredQueries: string[];
  authorityBlueprint: {
    required: AuthorityClass[];
    optional?: AuthorityClass[];
  };
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
    authorityBlueprint: {
      required: ["governing_rule", "procedural_mechanism"],
      optional: ["constraint_or_qualification"],
    },
  },
  {
    id: "point_of_order",
    aliases: ["point of order"],
    preferredQueries: ["point of order"],
    authorityBlueprint: {
      required: ["procedural_mechanism"],
    },
  },
  {
    id: "personal_reflection",
    aliases: ["personal attack", "attack on member", "right to speak"],
    preferredQueries: ["personal reflections", "against members"],
    authorityBlueprint: {
      required: ["governing_rule"],
    },
  },
  {
    id: "allegation_of_racism",
    aliases: ["racist", "racism", "country of origin", "ethnicity"],
    preferredQueries: ["allegations of racism"],
    authorityBlueprint: {
      required: ["governing_rule"],
    },
  },
  {
    id: "relevancy",
    aliases: ["evasive", "evasiveness", "off topic", "not relevant"],
    preferredQueries: ["relevancy"],
    authorityBlueprint: {
      required: ["governing_rule"],
    },
  },
  {
    id: "chair_control",
    aliases: ["chair", "speaker control"],
    preferredQueries: ["chairperson"],
    authorityBlueprint: {
      required: ["chair_control"],
    },
  },
  {
    id: "committee_of_whole",
    aliases: ["committee of the whole"],
    preferredQueries: ["committee of the whole"],
    authorityBlueprint: {
      required: [],
      optional: ["chair_control"],
    },
  },
  {
    id: "withdrawal_and_apology",
    aliases: ["withdraw", "apologise", "apology", "withdrawal"],
    preferredQueries: ["withdrawal", "procedure"],
    authorityBlueprint: {
      required: ["procedural_mechanism"],
      optional: ["constraint_or_qualification", "chair_control"],
    },
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
    preferredQueries: ["accountability to the House", "point of order"],
    authorityBlueprint: {
      required: ["governing_rule", "procedural_mechanism"],
      optional: ["constraint_or_qualification"],
    },
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
    authorityBlueprint: {
      required: ["procedural_mechanism"],
      optional: ["constraint_or_qualification", "chair_control"],
    },
  },
];
