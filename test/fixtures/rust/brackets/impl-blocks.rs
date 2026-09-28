struct Point {
    x: i32,
    y: i32,
}
enum Shape { Circle, Rect }
impl Point {
    fn new(x: i32, y: i32) -> Self {
        Point { x, y }
    }
    fn step(&mut self, n: i32) -> i32 {
        if n > 0 {
            self.x += n;
        }
        for i in 0..n {
            self.y += i;
        }
        self.x
    }
}
impl<T: Clone> Clone for Wrapper<T>
where T: Copy {
    fn clone(&self) -> Self {
        self.clone()
    }
}
mod geometry {
    pub fn area() -> i32 { 0 }
}
