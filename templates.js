/* ============================================================
   TEMPLATES.JS — Startpakketten voor nieuwe huizen
   ============================================================
   Bij het aanmaken van een huis kies je een startpakket. Daarna
   kan het huis alles zelf aanpassen (taken, regels, straf).
   Iconen: sparkle (vaat), trash, wind (stofzuigen), bathtub,
   pan, plant, shirt, cart, broom.
   ============================================================ */

const TASK_ICONS = ["sparkle", "trash", "wind", "bathtub", "pan", "plant", "shirt", "cart", "broom"];
const RULE_ICONS = ["bell", "sparkle", "moon", "trash", "info", "heart", "book"];

// Kleuren die een bewoner kan krijgen (klassen staan in style.css)
const MEMBER_COLORS = ["card-pink", "card-blue", "card-orange", "card-green", "card-yellow", "card-lilac", "card-sky", "card-red"];

const TEMPLATES = {
  studentenhuis: {
    label: "Studentenhuis",
    blurb: "4 vaste klussen, rouleert elke week",
    strikesEnabled: true,
    strikePenalty: "3 keer vergeten = koken én betalen voor het hele huis",
    tasks: [
      { name: "Badkamer & wc", icon: "bathtub", instructions: "Wastafel, douche en wc schoon. Spiegel ook. Ja, ook achter de wc." },
      { name: "Vuilnis & woonkamer", icon: "trash", instructions: "Zorg dat de bakken de hele week geleegd worden en vergeet het recycling niet. Woonkamer even opruimen en zuigen." },
      { name: "Zuigen: gang, trap & keuken", icon: "wind", instructions: "Stofzuig de gang, de trap en de keuken. Kruimels onder de bank tellen ook." },
      { name: "Taaie week maat", icon: "sparkle", instructions: "Vaatwasser in- en uitruimen, koelkast checken op levensvormen en het karton weggooien." }
    ],
    rules: [
      { icon: "bell", text: "3 keer achter elkaar je taakje vergeten = koken en betalen voor het hele huis" },
      { icon: "sparkle", text: "Wie kookt, ruimt niet af" },
      { icon: "moon", text: "Feestje gegeven? Dan ruim jij de volgende ochtend op" },
      { icon: "info", text: "Mensen over de vloer? Even melden in de groep" }
    ]
  },
  klein: {
    label: "Klein huis (2–3)",
    blurb: "Stellen of kleine huizen",
    strikesEnabled: false,
    strikePenalty: "",
    tasks: [
      { name: "Badkamer", icon: "bathtub", instructions: "Wastafel, douche, wc en spiegel." },
      { name: "Keuken & vuilnis", icon: "pan", instructions: "Aanrecht, kookplaat en vuilnis buiten zetten." },
      { name: "Stofzuigen", icon: "wind", instructions: "Het hele huis een keer door." }
    ],
    rules: [
      { icon: "heart", text: "Wie kookt, ruimt niet af" }
    ]
  },
  leeg: {
    label: "Zelf samenstellen",
    blurb: "Begin met een lege lijst",
    strikesEnabled: false,
    strikePenalty: "",
    tasks: [],
    rules: []
  }
};
