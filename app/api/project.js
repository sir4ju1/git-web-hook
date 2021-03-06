import { RestGen, route } from 'microback'
import Auth from 'helper/auth'
import Pull from 'helper/git'
import Shell from 'helper/shell'
import Project from 'model/project'
import WorkItem from 'model/workitem'
import Iteration from 'model/iteration'
import Repo from 'model/repo'

export default class ProjectRest extends RestGen {
  constructor () {
    super('project', Project)
  }
  async find (ctx) {
    try {
      const projects = await Project.find()
      .select({ name: 1, status: 1, tfs_id: 1 })
      .sort({ status: 1 })
      .exec()
      ctx.body = { success: true, data: projects }
    } catch (error) {
      ctx.body = { success: false, error }
    }
  }
  @route('get', 'statistic')
  async statistic (ctx) {
    try {
      let projects = await Project.find({ status: 'active' })
      .populate({ path: 'repos', select: { name: 1 } })
      .populate('iterations')
      .populate('members').exec()
      projects = JSON.parse(JSON.stringify(projects))
      for (let i = 0; i < projects.length; i++) {
        let project = projects[i]
        const ccount = await WorkItem.aggregate([
          {
            $match: {
              project: project.tfs_id,
              type: { $ne: 'User Story' },
              state: 'Closed',
              isAccepted: { $ne: true }
            }
          },
          {
            $group: {
              _id: '$parent'
            }
          },
          {
            $count: 'total'
          }
        ])
        project.taskClosed =  ccount.length ? ccount[0].total : 0
        const activeIterations = project.iterations.filter(i => i.status === 'plan').map(i => i.name)
        for (let j = 0; j < project.members.length; j++) {
          const member = project.members[j]
          const mcount = await WorkItem.count({ project: project.tfs_id, assignedTo: `${member.displayName} <${member.uniqueName}>`, state: 'New', type: { $ne: 'User Story' } })
          const macount = await WorkItem.count({ project: project.tfs_id, assignedTo: `${member.displayName} <${member.uniqueName}>`, state: 'Active', type: { $ne: 'User Story' } })
          const mccount = await WorkItem.count({ project: project.tfs_id, assignedTo: `${member.displayName} <${member.uniqueName}>`, state: 'Closed', type: { $ne: 'User Story' } })
          member.taskCount = mcount
          member.taskActive = macount
          member.taskClosed = mccount
        }
        for (let j = 0; j < project.iterations.length; j++) {
          const iteration = project.iterations[j]
          const icount = await WorkItem.count({ project: project.tfs_id, iteration: iteration.name, type: 'User Story' })
          const iccount = await WorkItem.count({ project: project.tfs_id, iteration: iteration.name, state: 'Closed', type: 'User Story' })
          iteration.taskCount = icount
          iteration.taskClosed = iccount
        }
      }
      ctx.body = { success: true, data: projects }
    } catch (error) {
      ctx.body = { success: false, error: error.message }
    }
  }
  @route('get', ':project/workitems')
  async findWorkItems (ctx) {
    try {
      const project = ctx.params.project
      const projectObj = await Project.findOne({ _id: project }).select({ tfs_id: 1 }).exec()
      const workitems = await WorkItem.find({ project: projectObj.tfs_id, type: 'User Story' }).populate('tasks').exec()
      ctx.body = { success: true, data: workitems }
    } catch (error) {
      ctx.body = { success: false, error: error.message }
    }
  }
  @route('patch', 'repo')
  async repoCreate (ctx) {
    try {
      const body = ctx.request.body
      if (body.password) {
        const crypted = Auth.encrypt(body.password)
        body.password = crypted
      }
      var project = await Repo.update({ _id: body.id }, body)
      ctx.body = { success: true, data: project }
    } catch (error) {
      ctx.body = { success: true, error }
    }
  }

  async update (ctx) {
    const result = await Project.update({ _id: ctx.request.body.id }, ctx.request.body)
    ctx.body = { success: true, data: result }
  }

  async remove (ctx) {
    const id = ctx.params.id
    const result = await Project.remove({ _id: id })
    ctx.body = { success: true }
  }
  @route('patch', ':project/state/:state')
  async stateChange (ctx) {
    const id = ctx.params.project
    const status = ctx.params.state
    const result = await Project.update({ _id: id }, { status })
    ctx.body = { success: true, data: result }
  }
  @route('patch', ':milestone/release')
  async release (ctx) {
    const id = ctx.params.milestone
    const result = await Iteration.update({ _id: id }, { status: 'released' })
    ctx.body = { success: true, data: result }
  }
  @route('get', 'repo/:id')
  async repobyId (ctx) {
    const id = ctx.params.id
    const result = await Repo.findOne({ _id: id }).select({ password: 0 }).exec()
    ctx.body = { success: true, data: result }
  }
  @route('get', 'repo/:repo/pull')
  async pull (ctx) {
    try {
      const repoId = ctx.params.repo
      var repo = await Repo.findOne({ _id: repoId }).exec()
      if (repo) {
        const dec = Auth.decrypt(repo.password)
        var oid = await Pull(repo.location, repo.user, dec, repo.branch)
        var result = {}
        if (repo.previous_oid && repo.previous_oid !== oid.oid) {
          result = Shell.exec(repo.args, repo.location)
        } else {
          result.status = 'No Change'
        }
        repo.previous_oid = oid.oid
        await repo.save()
        ctx.body = { success: true, data: result }
      } else {
        ctx.body = { success: false, error: 'Repo not found!' }
      }
    } catch (e) {
      ctx.body = { success: false, error: e.message }
    }
  }

  @route('get', 'repo/:repo/rebuild')
  async rebuild (ctx) {
    try {
      var repo = await Repo.findOne({ _id: ctx.params.repo }).exec()
      if (repo) {
        const result = Shell.exec(repo.args, repo.location)
        ctx.body = { success: true, data: result }
      } else {
        ctx.body = { success: false, error: 'Repo not found!' }
      }
    } catch (e) {
      ctx.body = { success: false, error: e.message }
    }
  }
}
