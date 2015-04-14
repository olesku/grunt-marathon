/*
 * grunt-marathon
 * https://github.com/olesku/grunt-marathon
 *
 * Copyright (c) 2015 Ole Fredrik Skudsvik
 * Licensed under the MIT license.
 */

'use strict';

var request = require('request');
var os      = require('os');

module.exports = function(grunt) {

  var rollback = function(done, deployUrl) {
    request({
      url: deployUrl + '/versions',
      method: 'GET',
    }, function (err, resp, body) {
      if (resp.statusCode == 200) {
        var obj = JSON.parse(body);

        if (obj.versions.length < 2) {
          grunt.fail.fatal('No previous version to roll back to.')
        }
        
        grunt.log.subhead('Rolling back to ' + obj.versions[1] + '.');

        request({
          url: deployUrl,
          method: 'PUT',
          json: true,
          body: { version: obj.versions[1] },
        }, function (err, resp, body) {
          grunt.log.ok(JSON.stringify(body, null, 4));
          done();
        });

      } else {
        grunt.log.fatal('Error fetching previous versions.')
      }
    });
  };

  var getStatus = function(done, deployUrl, target) {
    request({
      url: deployUrl,
      method: 'GET',
      json: true,
      headers: { 'Accept': 'application/json' }
    }, function (err, resp, body) {

      if (err || resp.statusCode != 200) {
        grunt.fail.fatal('Could not fetch data from Marathon.');
      }
      
      grunt.log.debug('Statuscode:', resp.statusCode);
      grunt.log.debug(JSON.stringify(resp.body, null, 2));

      var healthyPercent  = Math.round((body.app.tasksHealthy / body.app.tasksRunning) * 100);
      var runningPercent  = Math.round((body.app.tasksRunning / body.app.instances) * 100);
      var stagedPercent   = Math.round((body.app.tasksStaged / body.app.instances) * 100);

      isNaN(healthyPercent) && (healthyPercent = 0);
      isNaN(runningPercent) && (runningPercent = 0);
      isNaN(stagedPercent)  && (stagedPercent  = 0);

      grunt.log.subhead('Application status', '(' + target + ')');
      grunt.log.ok('Running:', body.app.tasksRunning, '/', body.app.instances, '(' + runningPercent + '%)');
      grunt.log.ok('Healthy:', body.app.tasksHealthy, '/', body.app.tasksRunning, '(' + healthyPercent + '%)');
      
      if (parseInt(body.app.tasksUnhealthy) > 0) {
        grunt.log.warn("Unhealthy:", body.app.tasksUnhealthy);
      }

      if (body.app.tasksStaged > 0) 
        grunt.log.ok("Staged:", body.app.tasksStaged, '(' + stagedPercent + '%)');

      if (body.app.tasksRunning == 0)
        grunt.log.error('Application is DOWN!');
      else if ((body.app.instances - body.app.tasksRunning) > 0)
        grunt.log.warn('Applications is up, but only', body.app.tasksRunning, 'of', body.app.instances, 'instances is running.');
      else
        grunt.log.subhead('Application is up and running :)');

      done();
    });
  };

  var scale = function (done, deployUrl) {
    var numInst = parseInt(grunt.option('scale'));
    
    if (isNaN(numInst)) {
      grunt.fail.fatal('You need to specify number of instances to scale to.');
    }

    grunt.log.ok('Scale:', numInst);

    request({
      url: deployUrl,
      method: 'PUT',
      json: true,
      body: { instances: numInst }
    }, function (err, resp, body) {
      if (err)
        grunt.fail.fatal('Could not scale.');

      grunt.log.ok('Response code:', resp.statusCode);
      grunt.log.ok(JSON.stringify(body, null, 2));
      done();
    });
  };

  grunt.registerMultiTask('marathon', 'Control Mesosphere Marathon.', function() {
    var opts = this.options({
      apiVersion: 2,
      user: process.env.USER,
      taskFile: 'marathon.json',
      image: '',
      imageFromFile: '',
      deleteImageFile: false
    });

    if (opts.hasOwnProperty('imageFromFile') && opts.imageFromFile != '') {
      opts.image = grunt.file.read(opts.imageFromFile);
      opts.deleteImageFile && grunt.file.delete(opts.imageFromFile);
    }

    grunt.config.set('marathon.image', opts.image);

    var done = this.async();

    var task = JSON.parse(
      grunt.template.process(
        grunt.file.read(opts.taskFile)));

    var deployUrl =  task.endpoint + '/v' + opts.apiVersion + '/apps/' + task.id;

    task.hasOwnProperty('labels') || (task.labels = {});
    task.labels.deployedBy    = opts.user;
    task.labels.deployedFrom  = os.hostname();
    delete task.endpoint;

    if (grunt.option('rollback')) {
      rollback(done, deployUrl);
      return;
    }

    if (grunt.option('status')) {
      getStatus(done, deployUrl, this.target);
      return;
    }


    if (!isNaN(grunt.option('scale'))) {
      scale(done, deployUrl);
      return;
    }

    grunt.log.subhead("Deploying to " + deployUrl);
    
    request({
      url: deployUrl,
      method: 'PUT',
      json: true,
      body: task
    }, function (err, resp, body) {
      if (err || (resp.statusCode != 200 && resp.statusCode != 201)) {
        grunt.log.error('Deploy failed with statuscode: ' + resp.statusCode);
        
        if (body.hasOwnProperty('message')) {
          grunt.log.error(body.message);
        }

        grunt.fail.fatal('Deployment failed');
      } else {
        grunt.log.debug(JSON.stringify(body, null, 2));
        if (body.hasOwnProperty('deploymentId') && body.hasOwnProperty('version')) {
          grunt.log.ok('Success :)');
          grunt.log.ok('ID:', body.deploymentId);
          grunt.log.ok('Version:', body.version);
        }
      }
      done();
    });
  });
};