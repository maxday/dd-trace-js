'use strict'

const semver = require('semver')
const agent = require('../../dd-trace/test/plugins/agent')
const plugin = require('../src')

wrapIt()

describe('Plugin', () => {
  let couchbase
  let N1qlQuery
  let ViewQuery
  let SearchQuery
  let CbasQuery
  let cluster
  let bucket
  let tracer

  describe('couchbase', () => {
    withVersions(plugin, 'couchbase', version => {
      beforeEach(() => {
        tracer = global.tracer = require('../../dd-trace')
      })

      describe('without configuration', () => {
        beforeEach(() => {
          return agent.load(plugin, 'couchbase').then(() => {
            couchbase = require(`../../../versions/couchbase@${version}`).get()
            N1qlQuery = couchbase.N1qlQuery
            ViewQuery = couchbase.ViewQuery
            SearchQuery = couchbase.SearchQuery
            CbasQuery = couchbase.CbasQuery
          })
        })

        beforeEach(done => {
          cluster = new couchbase.Cluster('localhost:8091')
          cluster.authenticate('Administrator', 'password')
          cluster.enableCbas('localhost:8095')
          bucket = cluster.openBucket('datadog-test', (err) => done(err))
        })

        afterEach(() => {
          bucket.disconnect()
        })

        after(() => {
          expect(bucket.connected).to.equal(false)
          return agent.close()
        })

        it('should run the Query callback in the parent context', done => {
          if (process.env.DD_CONTEXT_PROPAGATION === 'false') return done()
          const query = 'SELECT 1+1'
          const n1qlQuery = N1qlQuery.fromString(query)
          const span = tracer.startSpan('test.query.cb')

          tracer.scope().activate(span, () => {
            cluster.query(n1qlQuery, (err, rows) => {
              expect(tracer.scope().active()).to.equal(span)
              done(err)
            })
          })
        })

        it('should run the Query event listener in the parent context', done => {
          if (process.env.DD_CONTEXT_PROPAGATION === 'false') return done()
          const query = 'SELECT 1+1'
          const n1qlQuery = N1qlQuery.fromString(query)
          const span = tracer.startSpan('test.query.listener')

          const emitter = cluster.query(n1qlQuery)

          tracer.scope().activate(span, () => {
            emitter.on('rows', () => {
              expect(tracer.scope().active()).to.equal(span)
              done()
            })
          })
        })

        it('should run the Bucket event listener in the parent context', done => {
          if (process.env.DD_CONTEXT_PROPAGATION === 'false') return done()
          bucket.disconnect()
          const span = tracer.startSpan('test')

          bucket = cluster.openBucket('datadog-test')

          tracer.scope().activate(span, () => {
            bucket.on('connect', () => {
              expect(tracer.scope().active()).to.equal(span)
              done()
            })
          })
        })

        describe('queries on cluster', () => {
          it('should handle N1QL queries', done => {
            const query = 'SELECT 1+1'
            const n1qlQuery = N1qlQuery.fromString(query)

            agent
              .use(traces => {
                const span = traces[0][0]
                expect(span).to.have.property('name', 'couchbase.call')
                expect(span).to.have.property('service', 'test-couchbase')
                expect(span).to.have.property('resource', query)
                expect(span).to.have.property('type', 'sql')
                expect(span.meta).to.have.property('span.kind', 'client')
                expect(span.meta).to.have.property('bucket.name', 'datadog-test')
                expect(span.meta).to.have.property('query.type', 'n1ql')
              })
              .then(done)
              .catch(done)

            cluster.query(n1qlQuery, (err) => {
              if (err) done(err)
            })

            if (semver.intersects(version, '2.4.0 - 2.5.0')) {
              // Due to bug JSCBC-491 in Couchbase, we have to reconnect to dispatch waiting queries
              const triggerBucket = cluster.openBucket('datadog-test', (err) => {
                if (err) done(err)
              })
              triggerBucket.on('connect', () => triggerBucket.disconnect())
            }
          })

          it('should handle Search queries', done => {
            const index = 'test'
            const searchQuery = SearchQuery.new(index, SearchQuery.queryString('eiffel'))

            agent
              .use(traces => {
                const span = traces[0][0]
                expect(span).to.have.property('name', 'couchbase.call')
                expect(span).to.have.property('service', 'test-couchbase')
                expect(span).to.have.property('resource', index)
                expect(span).to.have.property('type', 'sql')
                expect(span.meta).to.have.property('span.kind', 'client')
                expect(span.meta).to.have.property('bucket.name', 'datadog-test')
                expect(span.meta).to.have.property('query.type', 'search')
              })
              .then(done)
              .catch(done)

            cluster.query(searchQuery, (err) => {
              if (err) done(err)
            })

            if (semver.intersects(version, '2.4.0 - 2.5.0')) {
              // Due to bug JSCBC-491 in Couchbase, we have to reconnect to dispatch waiting queries
              const triggerBucket = cluster.openBucket('datadog-test', (err) => {
                if (err) done(err)
              })
              triggerBucket.on('connect', () => triggerBucket.disconnect())
            }
          })

          // Only couchbase v2.4.2 supports authentication with Analytics queries
          if (semver.intersects(version, '>=2.4.2')) {
            it('should handle Analytics queries', done => {
              const query = 'SELECT * FROM datatest'
              const cbasQuery = CbasQuery.fromString(query)

              agent
                .use(traces => {
                  const span = traces[0][0]
                  expect(span).to.have.property('name', 'couchbase.call')
                  expect(span).to.have.property('service', 'test-couchbase')
                  expect(span).to.have.property('resource', query)
                  expect(span).to.have.property('type', 'sql')
                  expect(span.meta).to.have.property('span.kind', 'client')
                  expect(span.meta).to.have.property('query.type', 'cbas')

                  if (semver.intersects(version, '>=2.6.0')) {
                    expect(span.meta).to.have.property('bucket.name', 'datadog-test')
                  }
                })
                .then(done)
                .catch(done)

              cluster.query(cbasQuery, (err) => {
                if (err) done(err)
              })
            })
          }
        })

        describe('queries on buckets', () => {
          it('should handle N1QL queries', done => {
            const query = 'SELECT 1+2'
            const n1qlQuery = N1qlQuery.fromString(query)

            agent
              .use(traces => {
                const span = traces[0][0]
                expect(span).to.have.property('name', 'couchbase.call')
                expect(span).to.have.property('service', 'test-couchbase')
                expect(span).to.have.property('resource', query)
                expect(span).to.have.property('type', 'sql')
                expect(span.meta).to.have.property('span.kind', 'client')
                expect(span.meta).to.have.property('bucket.name', 'datadog-test')
                expect(span.meta).to.have.property('query.type', 'n1ql')
              })
              .then(done)
              .catch(done)

            bucket.query(n1qlQuery, (err) => {
              if (err) done(err)
            })
          })

          it('should handle View queries ', done => {
            const viewQuery = ViewQuery.from('datadoc', 'by_name')

            agent
              .use(traces => {
                const span = traces[0][0]
                expect(span).to.have.property('name', 'couchbase.call')
                expect(span).to.have.property('service', 'test-couchbase')
                expect(span).to.have.property('resource', viewQuery.name)
                expect(span).to.have.property('type', 'sql')
                expect(span.meta).to.have.property('span.kind', 'client')
                expect(span.meta).to.have.property('bucket.name', 'datadog-test')
                expect(span.meta).to.have.property('ddoc', viewQuery.ddoc)
                expect(span.meta).to.have.property('query.type', 'view')
              })
              .then(done)
              .catch(done)

            bucket.query(viewQuery, (err) => {
              if (err) done(err)
            })
          })

          it('should handle Search queries', done => {
            const index = 'test'
            const searchQuery = SearchQuery.new(index, SearchQuery.queryString('eiffel'))

            agent
              .use(traces => {
                const span = traces[0][0]
                expect(span).to.have.property('name', 'couchbase.call')
                expect(span).to.have.property('service', 'test-couchbase')
                expect(span).to.have.property('resource', index)
                expect(span).to.have.property('type', 'sql')
                expect(span.meta).to.have.property('span.kind', 'client')
                expect(span.meta).to.have.property('bucket.name', 'datadog-test')
                expect(span.meta).to.have.property('query.type', 'search')
              })
              .then(done)
              .catch(done)

            bucket.query(searchQuery, (err) => {
              if (err) done(err)
            })
          })

          if (semver.intersects(version, '>=2.6.0')) {
            it('should handle Analytics queries', done => {
              const query = 'SELECT * FROM datatest'
              const cbasQuery = CbasQuery.fromString(query)

              agent
                .use(traces => {
                  const span = traces[0][0]
                  expect(span).to.have.property('name', 'couchbase.call')
                  expect(span).to.have.property('service', 'test-couchbase')
                  expect(span).to.have.property('resource', query)
                  expect(span).to.have.property('type', 'sql')
                  expect(span.meta).to.have.property('span.kind', 'client')
                  expect(span.meta).to.have.property('bucket.name', 'datadog-test')
                  expect(span.meta).to.have.property('query.type', 'cbas')
                })
                .then(done)
                .catch(done)

              bucket.query(cbasQuery, (err) => {
                if (err) done(err)
              })
            })
          }
        })
      })
    })
  })
})