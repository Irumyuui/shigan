namespace demo
{
    class Foo : public Base
    {
        int x;
    };

    struct Point
    {
        int y;
    };

    enum class Color
    {
        Red,
        Green
    };

    class Wrapped
        : public Base,
          public Other
    {
    };
}
