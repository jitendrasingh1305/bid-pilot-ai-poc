sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast) {
  "use strict";

  const SRV = "/bid-pilot";

  return Controller.extend("bid.pilot.dashboard.view.Dashboard", {

    onInit() {
      this._statsModel = new JSONModel({ total: 0, received: 0, inProgress: 0, deptReview: 0, submitted: 0, published: 0 });
      this._bidsModel  = new JSONModel({ items: [], allItems: [] });
      this.getView().setModel(this._statsModel, "stats");
      this.getView().setModel(this._bidsModel, "bids");
      this._load();
    },

    async _load() {
      await Promise.all([this._loadStats(), this._loadBids()]);
    },

    async _loadStats() {
      try {
        const res  = await fetch(`${SRV}/getDashboardStats()`);
        const data = await res.json();
        this._statsModel.setData(data.value || data);
      } catch (e) {
        console.error("Stats load error:", e);
      }
    },

    async _loadBids() {
      try {
        const res  = await fetch(`${SRV}/BidRequests?$orderby=createdAt desc&$expand=matchedProject`);
        const data = await res.json();
        const items = data.value || [];
        this._bidsModel.setProperty("/allItems", items);
        this._bidsModel.setProperty("/items", items);
      } catch (e) {
        console.error("Bids load error:", e);
      }
    },

    onRefresh() {
      MessageToast.show("Refreshing...");
      this._load();
    },

    onOpenJoule() {
      window.open("/joule-ui/webapp/index.html", "_blank");
    },

    onNewBid() {
      window.open("/joule-ui/webapp/index.html", "_blank");
    },

    // ── KPI tile press — filter by category ──────────────────────────
    onKpiPress(evt) {
      const id = evt.getSource().getId();
      const IN_PROGRESS = ["ai_processing", "pending_match", "draft_document", "no_match_rd", "pending_corrections"];
      const REVIEW      = ["dept_review", "final_review"];

      const all = this._bidsModel.getProperty("/allItems");
      let filtered, segKey;

      if      (id.endsWith("kpiReceived"))     { filtered = all.filter(b => b.status === "received");     segKey = "received"; }
      else if (id.endsWith("kpiProgress"))     { filtered = all.filter(b => IN_PROGRESS.includes(b.status)); segKey = "ai_processing"; }
      else if (id.endsWith("kpiReview"))       { filtered = all.filter(b => REVIEW.includes(b.status));   segKey = "dept_review"; }
      else if (id.endsWith("kpiDone"))         { filtered = all.filter(b => b.status === "submitted");    segKey = "submitted"; }
      else if (id.endsWith("kpiPublishedTile")){ filtered = all.filter(b => b.status === "published");    segKey = "published"; }
      else                                     { filtered = all; segKey = "all"; }

      this._bidsModel.setProperty("/items", filtered);
      const seg = this.byId("statusFilter");
      if (seg) seg.setSelectedKey(segKey);
    },

    // ── Status filter ─────────────────────────────────────────────────
    onStatusFilter(evt) {
      const key  = evt.getParameter("item").getKey();
      const all  = this._bidsModel.getProperty("/allItems");
      const filtered = key === "all" ? all : all.filter(b => b.status === key);
      this._bidsModel.setProperty("/items", filtered);
    },

    // ── Search ────────────────────────────────────────────────────────
    onSearch(evt) {
      const q   = (evt.getParameter("query") || "").toLowerCase();
      const all = this._bidsModel.getProperty("/allItems");
      const filtered = q
        ? all.filter(b =>
            (b.bidNumber || "").toLowerCase().includes(q) ||
            (b.customerName || "").toLowerCase().includes(q) ||
            (b.productFamily || "").toLowerCase().includes(q)
          )
        : all;
      this._bidsModel.setProperty("/items", filtered);
    },

    // ── Bid card press → navigate to detail ──────────────────────────
    onBidCardPress(evt) {
      const ctx = evt.getSource().getBindingContext("bids");
      if (!ctx) return;
      const bid = ctx.getObject();
      this.getOwnerComponent().getRouter().navTo("bidDetail", { bidId: bid.ID });
    }
  });
});
