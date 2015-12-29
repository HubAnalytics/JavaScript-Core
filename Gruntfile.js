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
        },
        
        gittag: {
            all: {
                options: {
                    tag: 'v<%= versionFile.version %>'
                }
            }
        },
        gitpush: {
            all: {
                options: {
                    tags: true
                }    
            }
        }
    });

    // Load the plugin that provides the "uglify" task.
    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-bower-concat');
    grunt.loadNpmTasks('grunt-bower-task');
    grunt.loadNpmTasks('grunt-git');

    // Default task(s).
    grunt.registerTask('default', ['bower', 'bower_concat', 'uglify']);
    
    // Release a bower version
    grunt.registerTask('releaseBower', ['gittag', 'gitpush']);
};