using { bid.pilot as db } from '../db/schema';

service BidPilotService @(path: '/bid-pilot') {

  // ── Read-only historical projects (reference data for matching) ─────────
  @readonly
  entity HistoricalProjects as projection on db.HistoricalProjects;

  // ── Main bid request entity ─────────────────────────────────────────────
  entity BidRequests as projection on db.BidRequests
    actions {
      action submitForAI()         returns BidRequests;
      action confirmMatch(historicalProjectId: UUID, notes: String) returns BidRequests;
      action rejectMatch()         returns BidRequests;
      action approveSection(department: String, comments: String) returns DeptReviews;
      action rejectSection(department: String, comments: String)  returns DeptReviews;
      action submitFinal()         returns BidRequests;
    };

  // ── Bid documents ───────────────────────────────────────────────────────
  entity BidDocuments  as projection on db.BidDocuments;

  // ── Department reviews ──────────────────────────────────────────────────
  entity DeptReviews   as projection on db.DeptReviews;

  // ── Notification log ────────────────────────────────────────────────────
  @readonly
  entity BidNotifications as projection on db.BidNotifications;

  // ── Dashboard KPI function ──────────────────────────────────────────────
  function getDashboardStats() returns {
    total: Integer; received: Integer; inProgress: Integer;
    deptReview: Integer; submitted: Integer; published: Integer;
  };
}
