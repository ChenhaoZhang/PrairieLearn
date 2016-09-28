var ERR = require('async-stacktrace');
var _ = require('lodash');
var path = require('path');
var async = require('async');
var csvStringify = require('csv').stringify;
var express = require('express');
var router = express.Router();

var error = require('../../error');
var questionServer = require('../../question-server');
var logger = require('../../logger');
var sqldb = require('../../sqldb');
var sqlLoader = require('../../sql-loader');

var sql = sqlLoader.load(path.join(__dirname, 'userInstanceQuestionExam.sql'));

function processSubmission(req, res, callback) {
    if (!res.locals.assessment_instance.open) return callback(error.make(400, 'assessmentInstance is closed'));
    if (!res.locals.instance_question.open) return callback(error.make(400, 'instanceQuestion is closed'));
    var grading;
    async.series([
        function(callback) {
            var params = {instance_question_id: res.locals.instance_question.id};
            sqldb.queryOneRow(sql.get_variant, params, function(err, result) {
                if (ERR(err, callback)) return;
                res.locals.variant = result.rows[0];
                callback(null);
            });
        },
        function(callback) {
            var params = {
                variant_id: res.locals.variant.id,
                auth_user_id: res.locals.user.id,
                submitted_answer: req.postData.submittedAnswer,
                type: req.postData.type,
                credit: res.locals.assessment.credit,
                mode: req.mode,
            };
            sqldb.queryOneRow(sql.new_submission, params, function(err, result) {
                if (ERR(err, callback)) return;
                res.locals.submission = result.rows[0];
                callback(null);
            });
        },
    ], callback);
};

router.post('/', function(req, res, next) {
    if (res.locals.assessment.type !== 'Exam') return next();
    if (req.postData.action == 'submitQuestionAnswer') {
        return processSubmission(req, res, function(err) {
            if (ERR(err, next)) return;
            res.redirect(res.locals.urlPrefix + '/instanceQuestion/' + res.locals.instance_question.id + '/');
        });
    } else {
        return next(error.make(400, 'unknown action: ' + req.postData.action, {postData: req.postData}));
    }
});

router.get('/', function(req, res, next) {
    if (res.locals.assessment.type !== 'Exam') return next();

    var questionModule;
    async.series([
        function(callback) {
            var params = {instance_question_id: res.locals.instance_question.id};
            sqldb.queryOneRow(sql.get_variant, params, function(err, result) {
                if (ERR(err, callback)) return;
                res.locals.variant = result.rows[0];
                callback(null);
            });
        },
        function(callback) {
            var params = {variant_id: res.locals.variant.id};
            sqldb.query(sql.get_submission, params, function(err, result) {
                if (ERR(err, callback)) return;
                if (result.rowCount == 1) {
                    res.locals.submission = result.rows[0];
                }
                callback(null);
            });
        },
        function(callback) {
            questionServer.getModule(res.locals.question.type, function(err, qm) {
                if (ERR(err, callback)) return;
                questionModule = qm;
                callback(null);
            });
        },
        function(callback) {
            questionModule.renderExtraHeaders(res.locals.question, res.locals.course, res.locals, function(err, extraHeaders) {
                if (ERR(err, callback)) return;
                res.locals.extraHeaders = extraHeaders;
                callback(null);
            });
        },
        function(callback) {
            // default to show none of the optional components
            res.locals.showSaveButton = false;
            res.locals.showFeedback = false;
            res.locals.showTrueAnswer = false;
            if (res.locals.assessment_instance.open) {
                if (res.locals.instance_question.open) {
                    res.locals.showSaveButton = true;
                }
                callback(null);
            } else {
                // assessmentInstance is closed, show true answer
                res.locals.showFeedback = true;
                res.locals.showTrueAnswer = true;
                questionModule.renderTrueAnswer(res.locals.variant, res.locals.question, res.locals.course, res.locals, function(err, answerHtml) {
                    if (ERR(err, callback)) return;
                    res.locals.answerHtml = answerHtml;
                    callback(null);
                });
            }
        },
        function(callback) {
            questionModule.renderQuestion(res.locals.variant, res.locals.question, res.locals.submission, res.locals.course, res.locals, function(err, questionHtml) {
                if (ERR(err, callback)) return;
                res.locals.questionHtml = questionHtml;
                callback(null);
            });
        },
        function(callback) {
            res.locals.postUrl = res.locals.urlPrefix + "/instanceQuestion/" + res.locals.instance_question.id + "/";
            res.locals.questionJson = JSON.stringify({
                questionFilePath: res.locals.urlPrefix + "/instanceQuestion/" + res.locals.instance_question.id + "/file",
                question: res.locals.question,
                course: res.locals.course,
                courseInstance: res.locals.course_instance,
                variant: {
                    id: res.locals.variant.id,
                    params: res.locals.variant.params,
                },
                submittedAnswer: res.locals.submission ? res.locals.submission.submitted_answer : null,
                feedback: (res.locals.showFeedback && res.locals.submission) ? res.locals.submission.feedback : null,
                trueAnswer: res.locals.showTrueAnswer ? res.locals.variant.true_answer : null,
            });
            res.locals.video = null;
            callback(null);
        },
    ], function(err) {
        if (ERR(err, next)) return;
        res.render(path.join(__dirname, 'userInstanceQuestionExam'), res.locals);
    });
});

module.exports = router;
