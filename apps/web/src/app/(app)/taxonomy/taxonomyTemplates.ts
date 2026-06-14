import type { TaxonomyTransferFile } from "@amarnai/shared";

export type TaxonomyTemplate = {
  id: string;
  name: string;
  description: string;
  file: TaxonomyTransferFile;
};

const DATE = "2026-01-01T00:00:00.000Z";

// Layout: root at x=0, L1 at x=300, L2 at x=600.
// Each node's y is the midpoint of its subtree's leaf span.
// Leaves spaced 140px apart, tree centered at y=0.

export const TAXONOMY_TEMPLATES: TaxonomyTemplate[] = [
  {
    id: "freelancer",
    name: "Freelancer",
    description: "For independent consultants and freelancers managing clients, projects, and finances.",
    // Leaves (top→bottom): Projects, Contracts, Invoices, Expenses, Admin, Leads, Personal
    file: {
      amarnaiTaxonomyVersion: 1,
      exportedAt: DATE,
      nodes: [
        { ref: "root",      name: "Inbox",    description: null, instructions: null, draftPrompt: null, examples: [], isRoot: true,  positionX: 0,   positionY: 0    },
        { ref: "clients",   name: "Clients",  description: "Active project communication, deliverables, feedback, and approvals from clients.",              instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: -350 },
        { ref: "projects",  name: "Projects", description: "Task coordination, milestones, and deliverable reviews for ongoing client projects.",            instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: -420 },
        { ref: "contracts", name: "Contracts",description: "Client agreements, statements of work, NDAs, and contract amendments.",                          instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: -280 },
        { ref: "finance",   name: "Finance",  description: "Billing, payments, invoices, and financial records for your freelance business.",                instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: -70  },
        { ref: "invoices",  name: "Invoices", description: "Invoices issued to clients and follow-ups on unpaid amounts.",                                   instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: -140 },
        { ref: "expenses",  name: "Expenses", description: "Business receipts, reimbursements, and records of work-related purchases.",                      instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: 0    },
        { ref: "admin",     name: "Admin",    description: "Legal, insurance, software subscriptions, and business administration notices.",                  instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 140  },
        { ref: "leads",     name: "Leads",    description: "New business inquiries, proposals, pricing discussions, and prospective client outreach.",        instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 280  },
        { ref: "personal",  name: "Personal", description: "Personal correspondence and emails unrelated to freelance work.",                                 instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 420  },
      ],
      edges: [
        { sourceRef: "root",    targetRef: "clients"   },
        { sourceRef: "clients", targetRef: "projects"  },
        { sourceRef: "clients", targetRef: "contracts" },
        { sourceRef: "root",    targetRef: "finance"   },
        { sourceRef: "finance", targetRef: "invoices"  },
        { sourceRef: "finance", targetRef: "expenses"  },
        { sourceRef: "root",    targetRef: "admin"     },
        { sourceRef: "root",    targetRef: "leads"     },
        { sourceRef: "root",    targetRef: "personal"  },
      ],
    },
  },
  {
    id: "employee",
    name: "Working Professional",
    description: "For employees managing work, team communication, and personal email in one inbox.",
    // Leaves (top→bottom): Team, Management, Partners, Recruiting, Finance, Admin, Personal
    file: {
      amarnaiTaxonomyVersion: 1,
      exportedAt: DATE,
      nodes: [
        { ref: "root",       name: "Inbox",      description: null, instructions: null, draftPrompt: null, examples: [], isRoot: true,  positionX: 0,   positionY: 0    },
        { ref: "work",       name: "Work",       description: "Professional emails related to your job, projects, and workplace activities.",              instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: -210 },
        { ref: "team",       name: "Team",       description: "Internal communication with colleagues, team updates, and project collaboration.",          instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: -420 },
        { ref: "management", name: "Management", description: "Emails from your manager: one-on-ones, performance reviews, and feedback.",                instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: -280 },
        { ref: "partners",   name: "Partners",   description: "External vendors, clients, and agencies you work with in a professional capacity.",         instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: -140 },
        { ref: "recruiting", name: "Recruiting", description: "Recruiter outreach, job applications, interview scheduling, and offer letters.",            instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: 0    },
        { ref: "finance",    name: "Finance",    description: "Payslips, expense reports, reimbursements, and employee benefits emails.",                  instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 140  },
        { ref: "admin",      name: "Admin",      description: "IT support, HR notices, legal documents, and internal administrative emails.",              instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 280  },
        { ref: "personal",   name: "Personal",   description: "Personal correspondence and emails unrelated to your professional role.",                   instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 420  },
      ],
      edges: [
        { sourceRef: "root", targetRef: "work"       },
        { sourceRef: "work", targetRef: "team"       },
        { sourceRef: "work", targetRef: "management" },
        { sourceRef: "work", targetRef: "partners"   },
        { sourceRef: "work", targetRef: "recruiting" },
        { sourceRef: "root", targetRef: "finance"    },
        { sourceRef: "root", targetRef: "admin"      },
        { sourceRef: "root", targetRef: "personal"   },
      ],
    },
  },
  {
    id: "founder",
    name: "Startup Founder",
    description: "For founders juggling investors, customers, hiring, legal, and press in one view.",
    // Leaves (top→bottom): Investors, Customers, Hiring, Operations, Legal, Press, Personal
    file: {
      amarnaiTaxonomyVersion: 1,
      exportedAt: DATE,
      nodes: [
        { ref: "root",       name: "Inbox",      description: null, instructions: null, draftPrompt: null, examples: [], isRoot: true,  positionX: 0,   positionY: 0    },
        { ref: "investors",  name: "Investors",  description: "Updates, term sheets, due diligence requests, cap table, and investor relations.",          instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: -420 },
        { ref: "customers",  name: "Customers",  description: "Customer support, onboarding, product feedback, churn, and success conversations.",         instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: -280 },
        { ref: "team",       name: "Team",       description: "Internal communications, HR, contractor coordination, and team operational emails.",        instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: -70  },
        { ref: "hiring",     name: "Hiring",     description: "Job applications, recruiter outreach, interview scheduling, and offer negotiations.",       instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: -140 },
        { ref: "operations", name: "Operations", description: "Vendor contracts, tools, infrastructure, and day-to-day operational communications.",       instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: 0    },
        { ref: "legal",      name: "Legal",      description: "Contracts, banking, accounting, tax filings, and corporate legal correspondence.",          instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 140  },
        { ref: "press",      name: "Press",      description: "Media inquiries, press coverage, co-marketing proposals, and partnership outreach.",        instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 280  },
        { ref: "personal",   name: "Personal",   description: "Personal correspondence and emails unrelated to your startup.",                             instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 420  },
      ],
      edges: [
        { sourceRef: "root", targetRef: "investors"  },
        { sourceRef: "root", targetRef: "customers"  },
        { sourceRef: "root", targetRef: "team"       },
        { sourceRef: "team", targetRef: "hiring"     },
        { sourceRef: "team", targetRef: "operations" },
        { sourceRef: "root", targetRef: "legal"      },
        { sourceRef: "root", targetRef: "press"      },
        { sourceRef: "root", targetRef: "personal"   },
      ],
    },
  },
  {
    id: "student",
    name: "Student",
    description: "For students balancing university, internship applications, and everyday life.",
    // Leaves (top→bottom): Courses, Campus Admin, Jobs, Finance, Social, Personal
    file: {
      amarnaiTaxonomyVersion: 1,
      exportedAt: DATE,
      nodes: [
        { ref: "root",         name: "Inbox",        description: null, instructions: null, draftPrompt: null, examples: [], isRoot: true,  positionX: 0,   positionY: 0    },
        { ref: "university",   name: "University",   description: "Official emails from your university: registrar, student services, and housing.",        instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: -280 },
        { ref: "courses",      name: "Courses",      description: "Professors, assignments, study groups, course announcements, and academic deadlines.",    instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: -350 },
        { ref: "campus_admin", name: "Campus Admin", description: "Enrollment, tuition fees, housing applications, and official campus administration.",     instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: -210 },
        { ref: "jobs",         name: "Jobs",         description: "Internship and job applications, recruiter messages, and interview invitations.",          instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: -70  },
        { ref: "finance",      name: "Finance",      description: "Student loans, rent, bank statements, and financial aid notifications.",                  instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 70   },
        { ref: "social",       name: "Social",       description: "Friends, campus events, clubs, social invitations, and extracurricular activities.",      instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 210  },
        { ref: "personal",     name: "Personal",     description: "Personal correspondence and non-academic emails for everyday life.",                       instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 350  },
      ],
      edges: [
        { sourceRef: "root",       targetRef: "university"   },
        { sourceRef: "university", targetRef: "courses"      },
        { sourceRef: "university", targetRef: "campus_admin" },
        { sourceRef: "root",       targetRef: "jobs"         },
        { sourceRef: "root",       targetRef: "finance"      },
        { sourceRef: "root",       targetRef: "social"       },
        { sourceRef: "root",       targetRef: "personal"     },
      ],
    },
  },
  {
    id: "personal",
    name: "Personal / Family",
    description: "For individuals managing finances, health, home, family, and personal subscriptions.",
    // Leaves (top→bottom): Taxes, Invoices, Health, Home, Family, Travel, Subscriptions
    file: {
      amarnaiTaxonomyVersion: 1,
      exportedAt: DATE,
      nodes: [
        { ref: "root",          name: "Inbox",         description: null, instructions: null, draftPrompt: null, examples: [], isRoot: true,  positionX: 0,   positionY: 0    },
        { ref: "finance",       name: "Finance",       description: "Bank statements, investments, insurance policies, and personal financial records.",     instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: -350 },
        { ref: "taxes",         name: "Taxes",         description: "Tax returns, government notices, fines, and annual contributions to state authorities.",instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: -420 },
        { ref: "invoices",      name: "Invoices",      description: "Personal bills, payment confirmations, receipts, and records of household expenses.",   instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 600, positionY: -280 },
        { ref: "health",        name: "Health",        description: "Doctors, pharmacies, medical appointments, health insurance claims, and lab results.",  instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: -140 },
        { ref: "home",          name: "Home",          description: "Utilities, landlord or mortgage communications, home maintenance, and property services.",instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 0    },
        { ref: "family",        name: "Family",        description: "Emails from relatives, children's schools, family events, and household coordination.", instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 140  },
        { ref: "travel",        name: "Travel",        description: "Flight and hotel bookings, travel itineraries, visa applications, and trip confirmations.",instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 280  },
        { ref: "subscriptions", name: "Subscriptions", description: "Streaming services, software subscriptions, memberships, and recurring notifications.", instructions: null, draftPrompt: null, examples: [], isRoot: false, positionX: 300, positionY: 420  },
      ],
      edges: [
        { sourceRef: "root",    targetRef: "finance"       },
        { sourceRef: "finance", targetRef: "taxes"         },
        { sourceRef: "finance", targetRef: "invoices"      },
        { sourceRef: "root",    targetRef: "health"        },
        { sourceRef: "root",    targetRef: "home"          },
        { sourceRef: "root",    targetRef: "family"        },
        { sourceRef: "root",    targetRef: "travel"        },
        { sourceRef: "root",    targetRef: "subscriptions" },
      ],
    },
  },
];
