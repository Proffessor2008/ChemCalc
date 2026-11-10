export const reactionCases = [
  {id:'permanganate-sulfite-acid',input:'KMnO4 + K2SO3',conditions:{medium:'acidic'},expected:'2KMnO4 + 5K2SO3 + 3H2SO4 = 2MnSO4 + 6K2SO4 + 3H2O'},
  {id:'permanganate-sulfite-neutral',input:'KMnO4 + K2SO3',conditions:{medium:'neutral'},expected:'2KMnO4 + 3K2SO3 + H2O = 2MnO2 + 3K2SO4 + 2KOH'},
  {id:'permanganate-sulfite-alkaline',input:'KMnO4 + K2SO3',conditions:{medium:'alkaline'},expected:'2KMnO4 + K2SO3 + 2KOH = 2K2MnO4 + K2SO4 + H2O'},
  {id:'dichromate-h2s',input:'K2Cr2O7 + H2S',conditions:{medium:'acidic'},expected:'K2Cr2O7 + 3H2S + 4H2SO4 = Cr2(SO4)3 + 3S + K2SO4 + 7H2O'},
  {id:'cu-nitric-dilute',input:'Cu + HNO3',conditions:{medium:'acidic',acidConcentration:'dilute'},expected:'3Cu + 8HNO3 = 3Cu(NO3)2 + 2NO + 4H2O'},
  {id:'cu-nitric-concentrated',input:'Cu + HNO3',conditions:{medium:'acidic',acidConcentration:'concentrated'},expected:'Cu + 4HNO3 = Cu(NO3)2 + 2NO2 + 2H2O'},
  {id:'zn-nitric-dilute',input:'Zn + HNO3',conditions:{medium:'acidic',acidConcentration:'dilute'},expected:'4Zn + 10HNO3 = 4Zn(NO3)2 + NH4NO3 + 3H2O'},
  {id:'zn-sulfuric-concentrated',input:'Zn + H2SO4',conditions:{medium:'acidic',acidConcentration:'concentrated'},expected:'4Zn + 5H2SO4 = 4ZnSO4 + H2S + 4H2O'},
  {id:'cu-sulfuric-dilute',input:'Cu + H2SO4',conditions:{medium:'acidic',acidConcentration:'dilute'},expected:null},
  {id:'fe-nitric-cold',input:'Fe + HNO3',conditions:{medium:'acidic',acidConcentration:'concentrated',heating:false},expected:null},
  {id:'fe-nitric-hot',input:'Fe + HNO3',conditions:{medium:'acidic',acidConcentration:'concentrated',heating:true},expected:'Fe + 6HNO3 = Fe(NO3)3 + 3NO2 + 3H2O'},
  {id:'chlorine-alkali-cold',input:'Cl2 + NaOH',conditions:{medium:'alkaline',heating:false},expected:'Cl2 + 2NaOH = NaCl + NaClO + H2O'},
  {id:'chlorine-alkali-hot',input:'Cl2 + NaOH',conditions:{medium:'alkaline',heating:true},expected:'3Cl2 + 6NaOH = 5NaCl + NaClO3 + 3H2O'},
  {id:'sulfur-alkali-hot',input:'S + KOH',conditions:{medium:'alkaline',heating:true},expected:'3S + 6KOH = 2K2S + K2SO3 + 3H2O'},
  {id:'phosphorus-alkali-hot',input:'P + NaOH',conditions:{medium:'alkaline',heating:true},expected:'4P + 3NaOH + 3H2O = PH3 + 3NaH2PO2'},
  {id:'co2-naoh-deficit',input:'CO2 + NaOH',conditions:{ratio:'deficit'},expected:'CO2 + NaOH = NaHCO3'},
  {id:'co2-naoh-normal',input:'CO2 + NaOH',conditions:{ratio:'normal'},expected:'CO2 + 2NaOH = Na2CO3 + H2O'},
  {id:'phosphoric-koh-deficit',input:'H3PO4 + KOH',conditions:{ratio:'deficit'},expected:'H3PO4 + KOH = KH2PO4 + H2O'},
  {id:'phosphoric-koh-normal',input:'H3PO4 + 3KOH',conditions:{ratio:'normal'},expected:'H3PO4 + 3KOH = K3PO4 + 3H2O'},
  {id:'electrolysis-nacl-water',input:'NaCl',conditions:{current:true,solvent:'aqueous'},expected:'2NaCl + 2H2O = H2 + Cl2 + 2NaOH'},
  {id:'electrolysis-nacl-melt',input:'NaCl',conditions:{current:true,solvent:'melt'},expected:'2NaCl = 2Na + Cl2'},
  {id:'electrolysis-cuso4',input:'CuSO4',conditions:{current:true,solvent:'aqueous'},expected:'2CuSO4 + 2H2O = 2Cu + O2 + 2H2SO4'},
  {id:'electrolysis-kno3',input:'KNO3',conditions:{current:true,solvent:'aqueous'},expected:'2H2O = 2H2 + O2'},
  {id:'aluminate-acid-deficit',input:'Na[Al(OH)4] + HCl',conditions:{ratio:'deficit'},expected:'Na[Al(OH)4] + HCl = Al(OH)3 + NaCl + H2O'},
  {id:'aluminate-acid-excess',input:'Na[Al(OH)4] + HCl',conditions:{ratio:'normal'},expected:'Na[Al(OH)4] + 4HCl = AlCl3 + NaCl + 4H2O'},
  {id:'hexahydroxo-ferrate-iodide',input:'K3[Fe(OH)6] + KI + HCl',conditions:{medium:'acidic'},expected:'2K3[Fe(OH)6] + 2KI + 14HCl = 2FeCl2 + I2 + 8KCl + 12H2O'},
  {id:'ferrocyanide-permanganate',input:'K4[Fe(CN)6] + KMnO4 + H2SO4',conditions:{medium:'acidic',heating:true},expected:'10K4[Fe(CN)6] + 122KMnO4 + 299H2SO4 = 10Fe(NO3)3 + 60CO2 + 122MnSO4 + 81K2SO4 + 299H2O'},
  {id:'chalcopyrite-nitric',input:'CuFeS2 + HNO3',conditions:{medium:'acidic',acidConcentration:'concentrated',heating:true},expected:'CuFeS2 + 18HNO3 = CuSO4 + Fe(NO3)3 + H2SO4 + 15NO2 + 8H2O'},
  {id:'pyrite-nitric',input:'FeS2 + HNO3',conditions:{medium:'acidic',acidConcentration:'concentrated',heating:true},expected:'FeS2 + 18HNO3 = Fe(NO3)3 + 2H2SO4 + 15NO2 + 7H2O'},
  {id:'cu2s-nitric',input:'Cu2S + HNO3',conditions:{medium:'acidic',acidConcentration:'concentrated',heating:true},expected:'Cu2S + 14HNO3 = 2Cu(NO3)2 + H2SO4 + 10NO2 + 6H2O'},
  {id:'alum-deficit',input:'KAl(SO4)2 + Ba(OH)2',conditions:{ratio:'deficit'},expected:'2KAl(SO4)2 + 3Ba(OH)2 = 2Al(OH)3 + 3BaSO4 + K2SO4'},
  {id:'alum-excess',input:'KAl(SO4)2 + Ba(OH)2',conditions:{ratio:'normal'},expected:'KAl(SO4)2 + 2Ba(OH)2 = Ba[Al(OH)4] + BaSO4 + KOH'},
  {id:'cu3p-nitric',input:'Cu3P + HNO3',conditions:{medium:'acidic',acidConcentration:'concentrated',heating:true},expected:'Cu3P + 11HNO3 = 3Cu(NO3)2 + H3PO4 + 5NO2 + 4H2O'},
  {id:'ammine-copper-acid',input:'Cu(NH3)42 + HCl',conditions:{ratio:'normal'},expected:'Cu(NH3)42 + 6HCl = CuCl2 + 4NH4Cl + 2H2O'},
  {id:'dichromate-ethanol',input:'K2Cr2O7 + CH3CH2OH + H2SO4',conditions:{medium:'acidic',heating:true},expected:'K2Cr2O7 + 3CH3CH2OH + 4H2SO4 = Cr2(SO4)3 + 3CH3CHO + K2SO4 + 7H2O'}
];

export const correctedEquations = {
  'hexahydroxo-ferrate-iodide': '2K3[Fe(OH)6] + 2KI + 12HCl = 2FeCl2 + I2 + 8KCl + 12H2O',
  'chalcopyrite-nitric': 'CuFeS2 + 20HNO3 = CuSO4 + Fe(NO3)3 + H2SO4 + 17NO2 + 9H2O',
  'alum-excess': '2KAl(SO4)2 + 4Ba(OH)2 = Ba[Al(OH)4]2 + 3BaSO4 + K2SO4',
  'cu3p-nitric': 'Cu3P + 17HNO3 = 3Cu(NO3)2 + H3PO4 + 11NO2 + 7H2O'
};

export const invalidExpectedIds = ['ferrocyanide-permanganate', 'ammine-copper-acid'];
