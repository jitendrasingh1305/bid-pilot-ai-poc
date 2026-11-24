namespace bid.pilot;
using { cuid, managed } from '@sap/cds/common';

// ─── Historical reference projects (seed data — read-only in POC) ──────────
entity HistoricalProjects : cuid {
  projectCode    : String(20);
  projectName    : String(200);
  customerName   : String(100);
  productFamily  : String(100);
  description    : String(1000);
  technicalSpec  : String(2000);
  complianceNote : String(1000);
  totalCost      : Decimal(15,2);
  currency       : String(3)  default 'INR';
  deliveredYear  : Integer;
  bidDocumentRef : String(200);
  similarityTags : String(500);
}

// ─── Incoming bid requests ─────────────────────────────────────────────────
entity BidRequests : cuid, managed {
  bidNumber       : String(20);
  customerName    : String(100);
  productFamily   : String(100);
  requirementText : String(5000);
  status          : String(30) enum {
    received;
    ai_processing;
    pending_match;
    no_match_rd;
    draft_document;
    dept_review;
    pending_corrections;
    final_review;
    submitted;
    published;
  } default 'received';
  submittedBy     : String(100);
  aiMatchScore    : Decimal(5,2);
  matchedProject  : Association to HistoricalProjects;
  bidDocuments    : Association to many BidDocuments on bidDocuments.bidRequest = $self;
  reviews         : Association to many DeptReviews on reviews.bidRequest = $self;
  notifications   : Association to many BidNotifications on notifications.bidRequest = $self;
}

// ─── Generated bid documents ───────────────────────────────────────────────
entity BidDocuments : cuid, managed {
  bidRequest         : Association to BidRequests;
  version            : Integer default 1;
  technicalSection   : String(5000);
  complianceSection  : String(5000);
  costingSection     : String(5000);
  estimatedCost      : Decimal(15,2);
  currency           : String(3) default 'INR';
  status             : String(20) enum { draft; under_review; approved; rejected; } default 'draft';
}

// ─── Departmental reviews ──────────────────────────────────────────────────
entity DeptReviews : cuid, managed {
  bidRequest   : Association to BidRequests;
  department   : String(20) enum { rd; compliance; costing; };
  status       : String(20) enum { pending; in_review; approved; rejected; } default 'pending';
  comments     : String(2000);
  reviewedBy   : String(100);
  reviewedAt   : Timestamp;
}

// ─── Notification log ─────────────────────────────────────────────────────
entity BidNotifications : cuid {
  bidRequest   : Association to BidRequests;
  eventType    : String(50);
  recipient    : String(200);
  subject      : String(200);
  body         : String(2000);
  sentAt       : Timestamp;
  status       : String(20) enum { pending; sent; failed; } default 'pending';
}
