var gulp = require('gulp');
var mocha = require('gulp-mocha');

var watcher = gulp.watch('./*.js', ['test']);

gulp.task('test', function() {
  return gulp.src('test.js', {read: false})
    .pipe(mocha({reporter: 'spec'}));
});

gulp.task('default', ['test']);
