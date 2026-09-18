// 기본 모드에서 "너무 쉬운 단어"로 보고 단어장 후보에서 제외할 목록 (5글자 이상 위주)
export const COMMON_WORDS = new Set(
  `about above after again against almost alone along already although always among another answer anyone
anything around asked away back because become before began behind being believe below better between
bring brought build built called came cannot carry cause certain change child children close come coming
could country course daily didn doesn during early earth either else enough every everyone everything
example family father feel feeling few field final first follow food found friend friends front game
getting given going gone great group happen happened having heard help here himself house however hundred
important inside instead itself keep kind knew know known large later learn least leave left less letter
life light little live living long looked looking made make making many matter maybe means might minute
minutes moment money month months more morning most mother move much music must myself name need needed
never night nothing number often only open order other others outside over own paper part people perhaps
person place plan play point power pretty probably problem put question quite rather ready real really
reason right room said same saying school second seemed seen sentence several should show side since small
something sometimes soon sound special start started state still stood story study such sure take taken
talk tell than thank that their them themselves then there these they thing things think thinking third
this those though thought three through time times today together told took toward town tried true trying
turn turned under until upon used using very voice wait walk want wanted wasn watch water ways week weeks
well went were what when where whether which while white whole whose why will with within without woman
women word words work world would write wrong year years young your yourself again ahead alright anyway
around aware became begin beside bigger biggest cannot doing doors every eyes fifteen finally gonna gotta
guess hands happy heart hello hours human idea just kept kinds knows later level lives looks lower makes
means member middle mind mine nearly needs next nice nobody noticed okay once others parts piece places
plans quiet quietly reach reads ready right sense shall short shows simple simply single sitting sleep
someone somewhere speak stand stay steps stop stuff table taking talking tells thanks theirs there thinks
those tired today tomorrow tonight truly trust understand usually wanna wants watched whatever whenever
who's without wonder working works worth wouldn written yesterday`
    .split(/\s+/)
    .filter(Boolean),
);
