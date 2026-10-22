/* Everything on the site that changes often lives in this file.
   Edit it, save, and reload the page. */

window.UNPC = {
  config: {
    // The public Google Form link (it ends in /viewform). Leave "" to show the email address instead.
    registerUrl: "",
    // Telegram channel, for example "https://t.me/your_channel". Leave "" to hide the link.
    telegramUrl: "",
    email: "tashpulatovo211@gmail.com",
    // Leave "" to always show the coming Sunday. Write a date like "2026-11-01" to set it by hand.
    nextTournament: ""
  },

  // The first person is shown large on the Team page and opens the list on the home page.
  // Portraits are 4:5. Put each file at the path in "photo" (at least 800 x 1000 px).
  organizers: [
    {
      id: "ozodbek-toshpulatov",
      name: "Ozodbek Toshpulatov",
      role: "Founder and CEO",
      school: "Sodiq School, Tashkent",
      photo: "photos/team/ozodbek-toshpulatov.jpg",
      bio: "I started UNPC in 2026, in my final year at Sodiq School. I ran the first tournament on 4 October, I invite our judges and guest speakers, and I sent the first winning resolution to the Oliy Majlis.",
      more: "Outside UNPC, I am co-writing a book in Uzbek on the parliaments of 188 countries with the Youth Parliament of the Oliy Majlis.",
      links: { email: "tashpulatovo211@gmail.com" }
    },
    // Placeholders: replace the name, role, school, photo and bio with a real organizer.
    {
      id: "organizer-2",
      placeholder: true,
      name: "Organizer name",
      role: "Head of judging",
      school: "School, grade",
      photo: "photos/team/organizer-2.jpg",
      bio: "Two or three sentences in the first person about what this organizer does at UNPC. Edit them in assets/data.js.",
      links: {}
    },
    {
      id: "organizer-3",
      placeholder: true,
      name: "Organizer name",
      role: "Head of cases",
      school: "School, grade",
      photo: "photos/team/organizer-3.jpg",
      bio: "Two or three sentences in the first person about what this organizer does at UNPC. Edit them in assets/data.js.",
      links: {}
    },
    {
      id: "organizer-4",
      placeholder: true,
      name: "Organizer name",
      role: "Head of partnerships",
      school: "School, grade",
      photo: "photos/team/organizer-4.jpg",
      bio: "Two or three sentences in the first person about what this organizer does at UNPC. Edit them in assets/data.js.",
      links: {}
    },
    {
      id: "organizer-5",
      placeholder: true,
      name: "Organizer name",
      role: "Head of logistics",
      school: "School, grade",
      photo: "photos/team/organizer-5.jpg",
      bio: "Two or three sentences in the first person about what this organizer does at UNPC. Edit them in assets/data.js.",
      links: {}
    },
    {
      id: "organizer-6",
      placeholder: true,
      name: "Organizer name",
      role: "Head of media",
      school: "School, grade",
      photo: "photos/team/organizer-6.jpg",
      bio: "Two or three sentences in the first person about what this organizer does at UNPC. Edit them in assets/data.js.",
      links: {}
    }
  ],

  // Logos: a PNG or SVG with a transparent background, at the path in "logo".
  // Until the file exists, the name is set in type instead.
  partners: [
    {
      id: "oliy-majlis",
      name: "Oliy Majlis",
      detail: "Legislative Chamber",
      role: "Case topics",
      logo: "photos/partners/oliy-majlis.png",
      url: "https://parliament.gov.uz",
      text: "A member of the Legislative Chamber gave us the case topics for our first tournament. Bobur Bekmurodov, MP, was our guest on 4 October, and we sent him the winning team's proposal."
    },
    {
      id: "the-diplomat",
      name: "The Diplomat",
      role: "Prizes",
      logo: "photos/partners/the-diplomat.png",
      url: "https://thediplomat.com",
      text: "The Diplomat gives our winning teams a one-year subscription to the magazine."
    },
    {
      id: "sodiq-school",
      name: "Sodiq School",
      role: "Venue",
      logo: "photos/partners/sodiq-school.png",
      text: "Sodiq School in Tashkent hosted the first tournament on Sunday 4 October 2026."
    },
    {
      id: "knpc",
      name: "Kazakhstan National Policy Competition",
      short: "KNPC",
      role: "Sister competition",
      logo: "photos/partners/knpc.png",
      text: "A local organizer runs the UNPC format for high school students in Kazakhstan."
    }
  ]
};
