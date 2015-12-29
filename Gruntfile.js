module.exports = function (grunt) {

    // Project configuration.
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        
        versionFile: grunt.file.readJSON('version.json'),
        
        bower: {
            install: {
                options: {
                    copy: false
                }
            }
        },
        uglify: {
            options: {
                banner: '/*! <%= pkg.name %> <%= grunt.template.today("yyyy-mm-dd") %> */\n'
            },
            build: {
                src: ['tmp/bower.js', 'microserviceAnalyticsCore.js'],
                dest: 'lib/<%= pkg.name %>.<%= versionFile.version %>.min.js'
            }
        },
        bower_concat: {
            all: {
                dest: 'tmp/bower.js'
            }
        }
    });

    // Load the plugin that provides the "uglify" task.
    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-bower-concat');
    grunt.loadNpmTasks('grunt-bower-task');

    // Default task(s).
    grunt.registerTask('default', ['bower', 'bower_concat', 'uglify']);
};