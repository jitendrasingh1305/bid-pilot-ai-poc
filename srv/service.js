const cds = require('@sap/cds');
const notifications = require('./notifications');

module.exports = cds.service.impl(async function (srv) {

  const { BidRequests, BidDocuments, DeptReviews, BidNotifications, HistoricalProjects } = srv.entities;

  // Extract bound entity key robustly across CAP versions
  function _key(req) {
    const p = req.params?.[0];
    if (!p) return null;
    return typeof p === 'object' ? (p.ID ?? p.id ?? Object.values(p)[0]) : p;
  }

  // ── Auto-generate bid number on create ─────────────────────────────────
  srv.before('CREATE', BidRequests, (req) => {
    const ts = Date.now().toString().slice(-6);
    req.data.bidNumber ??= `BID-${ts}`;
    req.data.status ??= 'received';
  });

  // ── submitForAI: received → ai_processing → (auto) pending_match ────────
  srv.on('submitForAI', BidRequests, async (req) => {
    const bid = await SELECT.one.from(BidRequests).where({ ID: _key(req) });
    if (!bid) return req.error(404, 'Bid request not found');
    if (!['received', 'pending_match'].includes(bid.status))
      return req.error(400, `Cannot submit from status: ${bid.status}`);

    // Transition to ai_processing
    await UPDATE(BidRequests).set({ status: 'ai_processing' }).where({ ID: bid.ID });

    // Simulate AI matching — find best match from historical projects by tag overlap
    const historical = await SELECT.from(HistoricalProjects);
    const bestMatch = findBestMatch(bid.requirementText, bid.productFamily, historical);

    const matchScore = bestMatch ? bestMatch.score : 0;
    const matchedId  = bestMatch ? bestMatch.project.ID : null;

    // Transition to pending_match (or no_match_rd if nothing found)
    const nextStatus = matchedId ? 'pending_match' : 'no_match_rd';
    await UPDATE(BidRequests).set({
      status: nextStatus,
      aiMatchScore: matchScore,
      matchedProject_ID: matchedId
    }).where({ ID: bid.ID });

    await notifications.send(srv, bid.ID, 'AI_MATCH_READY', bid.submittedBy,
      `BidPilot: AI match ready for ${bid.bidNumber}`,
      matchedId
        ? `AI found a match (score: ${matchScore}%). Please review and confirm.`
        : `No historical match found for ${bid.bidNumber}. Routing to R&D.`
    );

    return SELECT.one.from(BidRequests).where({ ID: bid.ID });
  });

  // ── confirmMatch: pending_match → draft_document ─────────────────────
  srv.on('confirmMatch', BidRequests, async (req) => {
    const { historicalProjectId, notes } = req.data;
    const bid = await SELECT.one.from(BidRequests).where({ ID: _key(req) });
    if (!bid) return req.error(404, 'Bid request not found');
    if (bid.status !== 'pending_match') return req.error(400, 'Bid must be in pending_match status');

    const hist = await SELECT.one.from(HistoricalProjects).where({ ID: historicalProjectId });
    if (!hist) return req.error(404, 'Historical project not found');

    // Generate draft bid document based on historical project
    const docId = cds.utils.uuid();
    await INSERT.into(BidDocuments).entries({
      ID: docId,
      bidRequest_ID: bid.ID,
      version: 1,
      technicalSection: buildTechSection(hist, bid),
      complianceSection: buildComplianceSection(hist, bid),
      costingSection: buildCostingSection(hist, bid),
      estimatedCost: hist.totalCost * 1.1,
      status: 'draft'
    });

    // Create 3 parallel dept review records
    const depts = ['rd', 'compliance', 'costing'];
    for (const dept of depts) {
      await INSERT.into(DeptReviews).entries({
        ID: cds.utils.uuid(),
        bidRequest_ID: bid.ID,
        department: dept,
        status: 'pending'
      });
    }

    await UPDATE(BidRequests).set({
      status: 'draft_document',
      matchedProject_ID: historicalProjectId
    }).where({ ID: bid.ID });

    // Notify all 3 departments simultaneously
    const deptNames = { rd: 'R&D Team', compliance: 'Compliance Team', costing: 'Costing Team' };
    for (const dept of depts) {
      await notifications.send(srv, bid.ID, `REVIEW_ASSIGNED_${dept.toUpperCase()}`,
        `${deptNames[dept]} <${dept}@company.com>`,
        `BidPilot: Action required — review ${dept.toUpperCase()} section for ${bid.bidNumber}`,
        `A new bid document has been prepared for ${bid.customerName}. Please review and update the ${dept} section.`
      );
    }

    await UPDATE(BidRequests).set({ status: 'dept_review' }).where({ ID: bid.ID });

    return SELECT.one.from(BidRequests).where({ ID: bid.ID });
  });

  // ── rejectMatch: pending_match → no_match_rd ─────────────────────────
  srv.on('rejectMatch', BidRequests, async (req) => {
    const bid = await SELECT.one.from(BidRequests).where({ ID: _key(req) });
    if (!bid) return req.error(404, 'Bid request not found');
    if (bid.status !== 'pending_match') return req.error(400, 'Bid must be in pending_match status');

    await UPDATE(BidRequests).set({ status: 'no_match_rd', matchedProject_ID: null }).where({ ID: bid.ID });

    await notifications.send(srv, bid.ID, 'RD_HANDOVER', 'rd@company.com',
      `BidPilot: New product development required — ${bid.bidNumber}`,
      `Sales rejected AI match for ${bid.customerName}. This bid requires new product design. Please initiate R&D intake.`
    );

    return SELECT.one.from(BidRequests).where({ ID: bid.ID });
  });

  // ── approveSection / rejectSection ────────────────────────────────────
  srv.on('approveSection', BidRequests, async (req) => {
    return _updateSection(req, srv, 'approved');
  });

  srv.on('rejectSection', BidRequests, async (req) => {
    return _updateSection(req, srv, 'rejected');
  });

  // ── submitFinal: final_review → submitted ─────────────────────────────
  srv.on('submitFinal', BidRequests, async (req) => {
    const bid = await SELECT.one.from(BidRequests).where({ ID: _key(req) });
    if (!bid) return req.error(404, 'Bid request not found');
    if (bid.status !== 'final_review') return req.error(400, 'Bid must be in final_review status');

    await UPDATE(BidRequests).set({ status: 'submitted' }).where({ ID: bid.ID });

    await notifications.send(srv, bid.ID, 'BID_SUBMITTED', bid.submittedBy,
      `BidPilot: Bid ${bid.bidNumber} submitted to customer`,
      `The bid for ${bid.customerName} has been finalised and submitted. Bid number: ${bid.bidNumber}.`
    );

    return SELECT.one.from(BidRequests).where({ ID: bid.ID });
  });

  // ── getDashboardStats ─────────────────────────────────────────────────
  srv.on('getDashboardStats', async () => {
    const rows = await SELECT.from(BidRequests).columns('status', 'count(*) as cnt').groupBy('status');
    const map  = Object.fromEntries(rows.map(r => [r.status, Number(r.cnt)]));
    const inProgress = (map.ai_processing || 0) + (map.pending_match || 0) +
                       (map.draft_document || 0) + (map.no_match_rd || 0) +
                       (map.pending_corrections || 0);
    return {
      total:      rows.reduce((s, r) => s + Number(r.cnt), 0),
      received:   map.received   || 0,
      inProgress,
      deptReview: (map.dept_review || 0) + (map.final_review || 0),
      submitted:  map.submitted  || 0,
      published:  map.published  || 0
    };
  });

  // ─────────────────── private helpers ────────────────────────────────────

  async function _updateSection(req, srv, newStatus) {
    const { department, comments } = req.data;
    const bid = await SELECT.one.from(BidRequests).where({ ID: _key(req) });
    if (!bid) return req.error(404, 'Bid request not found');
    if (bid.status !== 'dept_review') return req.error(400, 'Bid must be in dept_review status');

    const review = await SELECT.one.from(DeptReviews).where({ bidRequest_ID: bid.ID, department });
    if (!review) return req.error(404, `No review found for department: ${department}`);

    await UPDATE(DeptReviews).set({
      status: newStatus, comments,
      reviewedAt: new Date().toISOString()
    }).where({ ID: review.ID });

    // Check if all 3 departments are done
    const allReviews = await SELECT.from(DeptReviews).where({ bidRequest_ID: bid.ID });
    const allApproved = allReviews.every(r => r.status === 'approved');
    const anyRejected = allReviews.some(r => r.status === 'rejected');

    if (anyRejected) {
      await UPDATE(BidRequests).set({ status: 'pending_corrections' }).where({ ID: bid.ID });
      await notifications.send(srv, bid.ID, 'CORRECTIONS_REQUIRED', bid.submittedBy,
        `BidPilot: Corrections required — ${bid.bidNumber}`,
        `Department ${department.toUpperCase()} has requested corrections for bid ${bid.bidNumber}.`
      );
    } else if (allApproved) {
      await UPDATE(BidRequests).set({ status: 'final_review' }).where({ ID: bid.ID });
      await notifications.send(srv, bid.ID, 'ALL_DEPTS_APPROVED', bid.submittedBy,
        `BidPilot: All departments approved — ${bid.bidNumber} ready for final review`,
        `All departmental sections have been approved. Please do a final review and submit.`
      );
    }

    return SELECT.one.from(DeptReviews).where({ ID: review.ID });
  }

  function findBestMatch(requirementText, productFamily, historical) {
    if (!historical || historical.length === 0) return null;
    const reqWords = new Set((requirementText + ' ' + productFamily).toLowerCase().split(/\W+/).filter(Boolean));
    let best = null;
    for (const proj of historical) {
      const tags = (proj.similarityTags + ' ' + proj.productFamily + ' ' + proj.description).toLowerCase();
      const tagWords = tags.split(/\W+/).filter(Boolean);
      const overlap  = tagWords.filter(w => reqWords.has(w)).length;
      const score    = Math.min(99, Math.round((overlap / Math.max(reqWords.size, 1)) * 120));
      if (!best || score > best.score) best = { project: proj, score };
    }
    return best && best.score >= 20 ? best : null;
  }

  function buildTechSection(hist, bid) {
    return `TECHNICAL FEASIBILITY SECTION\n` +
      `Based on historical project: ${hist.projectName} (${hist.projectCode})\n\n` +
      `Customer: ${bid.customerName}\n` +
      `Product Family: ${bid.productFamily}\n\n` +
      `Historical Technical Specifications:\n${hist.technicalSpec}\n\n` +
      `[R&D REVIEW REQUIRED: Validate specifications against new customer requirements and update accordingly.]`;
  }

  function buildComplianceSection(hist, bid) {
    return `COMPLIANCE SECTION\n` +
      `Based on historical project: ${hist.projectName}\n\n` +
      `Historical Compliance Notes:\n${hist.complianceNote}\n\n` +
      `[COMPLIANCE REVIEW REQUIRED: Verify all regulatory and customer-specific compliance requirements.]`;
  }

  function buildCostingSection(hist, bid) {
    const adj = (hist.totalCost * 1.1).toLocaleString('en-IN');
    return `PRODUCT COSTING SECTION\n` +
      `Based on historical project: ${hist.projectName}\n\n` +
      `Historical Total Cost: ${hist.currency} ${hist.totalCost?.toLocaleString('en-IN')}\n` +
      `AI-estimated cost (10% uplift for new requirements): ${hist.currency} ${adj}\n\n` +
      `[COSTING REVIEW REQUIRED: Validate material, labour, and overhead costs against current rates.]`;
  }
});
