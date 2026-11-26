import assert from "node:assert/strict";
import test from "node:test";
import { validateV40Proposal, v402RecoveryCandidates, v402RepairRefusals,
  v401AcceptIndependentRepair, type V40ProposedWitness } from "../lib/ai/scenario-adjudication";

const body = "A member may address the presiding officer in any official language.";
const a = {sectionId:"a", citationLabel:"A", documentCorpus:"standing_orders", heading:"Languages", path:["Debate"],sectionContent:body};
const b = {...a,sectionId:"b",citationLabel:"B"};
const c = {...a,sectionId:"c",citationLabel:"C"};
const question = "A member speaks in an official language. Another member objects.";
const witness = (citationLabel:string, extra:Partial<V40ProposedWitness> = {}): V40ProposedWitness => ({
  citationLabel, role:"governing", exactQuote:body, actorMatches:true, settingMatches:true,
  actionMatches:true, stageMatches:true, rationale:"direct rule", ...extra,
});
const review = (selected:V40ProposedWitness[]) => validateV40Proposal({question,candidates:[a,b,c],proposal:{selected,remainingUncertainties:[],explanation:""}});

test("distinguishes omission, hard rejection and withheld qualifier",()=>{
  const first=review([witness("A",{role:"qualification"}),witness("B",{actionMatches:false})]);
  assert.deepEqual(first.authorities,[]);
  assert.deepEqual(first.dispositions.map(row=>row.status),["withheld_no_primary","rejected","not_nominated"]);
  assert.match(first.dispositions[1].reason,/action/);
  const eligible=v402RecoveryCandidates({question,candidates:[a,b,c],review:first});
  assert.deepEqual(eligible.map(x=>x.citationLabel),["A","C"]);
  const recovered=validateV40Proposal({question,candidates:eligible,proposal:{selected:[witness("C")],remainingUncertainties:["unsettled facet"],explanation:""}});
  assert.deepEqual(recovered.authorities,[c]);
  assert.deepEqual(recovered.gaps,["unsettled facet"]);
});
test("duplicate nomination cannot promote a qualifier to primary",()=>{
  const first=review([witness("A",{role:"qualification"}),witness("A")]);
  assert.equal(first.authorities.length,0);
  assert.ok(!v402RecoveryCandidates({question,candidates:[a,b,c],review:first}).includes(a));
});
test("unknown and fabricated witnesses fail closed",()=>{
  const first=review([witness("UNKNOWN"),witness("B",{exactQuote:"fabricated quotation that is long enough"})]);
  assert.equal(first.unavailableNominations,1);
  assert.equal(first.authorities.length,0);
  assert.equal(first.dispositions[1].reason,"unverified-verbatim-witness");
  assert.ok(!v402RecoveryCandidates({question,candidates:[a,b,c],review:first}).includes(b));
});
test("successful primary never invokes recovery",()=>{
  const first=review([witness("A")]);
  assert.deepEqual(first.authorities,[a]);
  assert.deepEqual(v402RecoveryCandidates({question,candidates:[a,b,c],review:first}),[]);
});
test("repair diagnostic is equivalent to original gate across refusal cases",()=>{
  const good={claimIds:["c1","c2"],validatedClaims:[{id:"c1",supported:true},{id:"c2",supported:true}],responsive:true,unaddressedParts:[],hasBottomLine:true,citationValid:true,mentionValid:true,sourceQualificationVetoes:0};
  const cases=[good,{...good,hasBottomLine:false},{...good,citationValid:false},{...good,mentionValid:false},{...good,sourceQualificationVetoes:1},{...good,responsive:false},{...good,unaddressedParts:["missing"]},{...good,claimIds:[]},{...good,claimIds:["c1","c1"]},{...good,validatedClaims:[{id:"c1",supported:true}]},{...good,validatedClaims:[{id:"c1",supported:true},{id:"c1",supported:true}]},{...good,validatedClaims:[{id:"c1",supported:true},{id:"other",supported:true}]},{...good,validatedClaims:[{id:"c1",supported:true},{id:"c2",supported:false}]}];
  for(const item of cases) assert.equal(v402RepairRefusals(item).length===0,v401AcceptIndependentRepair(item));
});
