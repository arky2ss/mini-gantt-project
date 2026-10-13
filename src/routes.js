'use strict';

const express = require('express');
const store = require('./store');
const {
  validateProjectInput,
  validateHolidayInput,
  validateActivityInput,
  validateResourceInput,
  validateAssignmentInput,
} = require('./validate');
const { badRequest, notFound } = require('./errors');
const { assertNoCycle } = require('./cpm');

/** Parse :id menjadi integer positif. */
function parseId(value, label) {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw badRequest(`Id ${label || 'parameter'} tidak valid: '${value}'`);
  }
  return num;
}

function createApiRouter(db) {
  const router = express.Router();

  /* ------------------------------ Proyek ------------------------------ */

  router.get('/projects', (req, res) => {
    res.json({ data: store.listProjects(db) });
  });

  router.post('/projects', (req, res) => {
    const input = validateProjectInput(req.body);
    res.status(201).json({ data: store.createProject(db, input) });
  });

  router.get('/projects/:id', (req, res) => {
    res.json({ data: store.getProject(db, parseId(req.params.id, 'proyek')) });
  });

  router.put('/projects/:id', (req, res) => {
    const input = validateProjectInput(req.body);
    res.json({ data: store.updateProject(db, parseId(req.params.id, 'proyek'), input) });
  });

  router.delete('/projects/:id', (req, res) => {
    res.json(store.deleteProject(db, parseId(req.params.id, 'proyek')));
  });

  /* ---------------------------- Hari libur ---------------------------- */

  router.get('/projects/:id/holidays', (req, res) => {
    const projectId = parseId(req.params.id, 'proyek');
    store.getProjectOr404(db, projectId);
    res.json({ data: store.listHolidays(db, projectId) });
  });

  router.post('/projects/:id/holidays', (req, res) => {
    const projectId = parseId(req.params.id, 'proyek');
    const input = validateHolidayInput(req.body);
    res.status(201).json({ data: store.addHoliday(db, projectId, input) });
  });

  router.delete('/holidays/:id', (req, res) => {
    res.json(store.deleteHoliday(db, parseId(req.params.id, 'hari libur')));
  });

  /* ----------------------------- Kegiatan ----------------------------- */

  router.get('/projects/:id/activities', (req, res) => {
    const projectId = parseId(req.params.id, 'proyek');
    store.getProjectOr404(db, projectId);
    res.json({ data: store.listActivities(db, projectId) });
  });

  router.post('/projects/:id/activities', (req, res) => {
    const projectId = parseId(req.params.id, 'proyek');
    const input = validateActivityInput(req.body);
    const activity = store.createActivity(db, projectId, input);
    checkCycle(db, projectId);
    res.status(201).json({ data: activity });
  });

  router.put('/activities/:id', (req, res) => {
    const activityId = parseId(req.params.id, 'kegiatan');
    const input = validateActivityInput(req.body);
    const activity = store.updateActivity(db, activityId, input);
    checkCycle(db, activity.project_id);
    res.json({ data: activity });
  });

  router.delete('/activities/:id', (req, res) => {
    res.json(store.deleteActivity(db, parseId(req.params.id, 'kegiatan')));
  });

  /* ------------------------------ Resource ---------------------------- */

  router.get('/projects/:id/resources', (req, res) => {
    const projectId = parseId(req.params.id, 'proyek');
    store.getProjectOr404(db, projectId);
    res.json({ data: store.listResources(db, projectId) });
  });

  router.post('/projects/:id/resources', (req, res) => {
    const projectId = parseId(req.params.id, 'proyek');
    const input = validateResourceInput(req.body);
    res.status(201).json({ data: store.createResource(db, projectId, input) });
  });

  router.put('/resources/:id', (req, res) => {
    const input = validateResourceInput(req.body);
    res.json({ data: store.updateResource(db, parseId(req.params.id, 'resource'), input) });
  });

  router.delete('/resources/:id', (req, res) => {
    res.json(store.deleteResource(db, parseId(req.params.id, 'resource')));
  });

  router.post('/activities/:id/resources', (req, res) => {
    const activityId = parseId(req.params.id, 'kegiatan');
    const input = validateAssignmentInput(req.body);
    res.status(201).json(store.assignResource(db, activityId, input.resource_id));
  });

  router.delete('/activities/:id/resources/:resourceId', (req, res) => {
    const activityId = parseId(req.params.id, 'kegiatan');
    const resourceId = parseId(req.params.resourceId, 'resource');
    res.json(store.unassignResource(db, activityId, resourceId));
  });

  /* ----------------------- Analitik: jadwal/PERT ---------------------- */

  router.get('/projects/:id/schedule', (req, res) => {
    const projectId = parseId(req.params.id, 'proyek');
    const { project, schedule, estimatedCost } = store.scheduleProject(db, projectId);
    res.json({
      data: {
        project,
        project_duration: schedule.projectDuration,
        project_start: schedule.projectStartDate,
        project_end: schedule.projectEndDate,
        calendar_days: schedule.calendarDays,
        estimated_cost: estimatedCost,
        activities: schedule.nodes,
      },
    });
  });

  router.get('/projects/:id/paths', (req, res) => {
    const projectId = parseId(req.params.id, 'proyek');
    res.json({ data: store.pathsProject(db, projectId) });
  });

  router.get('/projects/:id/pert', (req, res) => {
    const projectId = parseId(req.params.id, 'proyek');
    res.json({ data: store.pertProject(db, projectId) });
  });

  router.get('/projects/:id/summary', (req, res) => {
    const projectId = parseId(req.params.id, 'proyek');
    res.json({ data: store.summaryProject(db, projectId) });
  });

  return router;
}

/** Validasi tidak ada siklus setelah perubahan dependensi. */
function checkCycle(db, projectId) {
  try {
    assertNoCycle(store.activityGraph(db, projectId));
  } catch (err) {
    if (err && err.name === 'CycleError') {
      const graph = store.activityGraph(db, projectId);
      const label = (id) => {
        const a = graph.find((x) => x.id === id);
        return a ? a.code || a.name : String(id);
      };
      throw badRequest(
        `Dependensi melingkar terdeteksi: ${err.cycle.map(label).join(' -> ')}`,
        { cycle: err.cycle.map(label) }
      );
    }
    throw err;
  }
}

module.exports = { createApiRouter, parseId };
