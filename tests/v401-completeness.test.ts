import assert from "node:assert/strict";
import test from "node:test";
import { searchPlanSchema } from "../lib/ai/search-plan-schema";
import {
  v401MaterialEvidenceQueries, v401AcceptIndependentRepair,
  validateV40Proposal,
} from "../lib/ai/scenario-adjudication";

const base = {
  intent: "admissibility", preferredCorpus: null,
  searchQueries: ["languages", "interpretation"],
  salientTerms: [], notes: "test",
};
const incident = {
  kind: "incident", actor: "an MP", setting: "Chamber",
  action: "speaks", affectedPerson: null,
  proceduralMoment: "debate", decisionQuestion: "May they speak?",
  materialFacts: [], evidenceQueries: null,
};

test("v40.1: null affectedPerson and evidenceQueries normalise", () => {
  const parsed = searchPlanSchema.parse({...base, situation:incident});
  assert.equal(parsed.situation?.affectedPerson, "");
  assert.deepEqual(parsed.situation?.evidenceQueries, []);
});

test("v40.1: absent and null optional situation do not stop retrieval", () => {
  assert.equal(searchPlanSchema.parse({...base}).situation, undefined);
  assert.equal(searchPlanSchema.parse({...base, situation:null}).situation, undefined);
});

test("v40.1: malformed OPTIONAL situation drops only the advisory context", () => {
  const parsed=searchPlanSchema.parse({...base,situation:{...incident,actor:null}});
  assert.equal(parsed.situation,undefined);
  assert.deepEqual(parsed.searchQueries,["languages","interpretation"]);
});

test("v40.1: malformed CORE planner fields still fail closed", () => {
  assert.equal(searchPlanSchema.safeParse({...base,searchQueries:[]}).success,false);
  assert.equal(searchPlanSchema.safeParse({...base,intent:"unauthorised"}).success,false);
});

test("v40.1: recording queries exclude voting records", () => {
  assert.deepEqual(v401MaterialEvidenceQueries("An MP livestreams their speech"),
    ["coverage of proceedings","making recordings"]);
  assert.deepEqual(v401MaterialEvidenceQueries("Members record abstentions in a vote"),[]);
});

test("v40.1: device use alone cannot authorise recording", () => {
  const body="The use of electronic devices in the Chamber is permitted if they do not disrupt the House.";
  const candidate={sectionId:"e",citationLabel:"19/5",documentCorpus:"speakers_rulings",
    heading:"Telephones and electronic devices",path:["Behaviour in Chamber"],sectionContent:body};
  const result=validateV40Proposal({
    question:"An MP livestreams their speech using a phone. Is that allowed?",
    candidates:[candidate],proposal:{selected:[{
      citationLabel:"19/5",role:"governing",exactQuote:body,
      actorMatches:true,settingMatches:true,actionMatches:true,stageMatches:true,
      rationale:"claimed authority"}],remainingUncertainties:[],explanation:""},
  });
  assert.deepEqual(result.authorities,[]);
  assert.ok(result.rejected.some((line)=>line.includes("recording-permission-not-attested")));
});

test("v40.1: repair requires complete independent, responsive claim approval", () => {
  const valid={claimIds:["c1","c2"],validatedClaims:[{id:"c1",supported:true},
    {id:"c2",supported:true}],responsive:true,unaddressedParts:[],hasBottomLine:true,
    citationValid:true,mentionValid:true,sourceQualificationVetoes:0};
  assert.equal(v401AcceptIndependentRepair(valid),true);
  assert.equal(v401AcceptIndependentRepair({...valid,unaddressedParts:["objection"]}),false);
  assert.equal(v401AcceptIndependentRepair({...valid,hasBottomLine:false}),false);
  assert.equal(v401AcceptIndependentRepair({...valid,sourceQualificationVetoes:1}),false);
  assert.equal(v401AcceptIndependentRepair({...valid,validatedClaims:[{id:"c1",supported:true}]}),false);
  assert.equal(v401AcceptIndependentRepair({...valid,validatedClaims:[{id:"c1",supported:true},{id:"c1",supported:true}]}),false);
  assert.equal(v401AcceptIndependentRepair({...valid,validatedClaims:[{id:"c1",supported:true},{id:"c2",supported:false}]}),false);
});
