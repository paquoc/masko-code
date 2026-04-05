/// Timestamped logging macros for [masko HH:MM:SS] prefix
macro_rules! mlog {
    ($($arg:tt)*) => {
        println!("[masko {}] {}", chrono::Local::now().format("%H:%M:%S"), format!($($arg)*))
    };
}

macro_rules! mlog_err {
    ($($arg:tt)*) => {
        eprintln!("[masko {}] {}", chrono::Local::now().format("%H:%M:%S"), format!($($arg)*))
    };
}

